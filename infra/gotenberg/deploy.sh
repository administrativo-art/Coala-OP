#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOTENBERG_PROJECT_ID:-smart-converter-752gf}"
REGION="${GOTENBERG_REGION:-southamerica-east1}"
REPOSITORY="${GOTENBERG_REPOSITORY:-coala-services}"
SERVICE="${GOTENBERG_SERVICE:-coala-gotenberg}"
RELEASE="${GOTENBERG_RELEASE:-8.34.0-coala.1}"
INVOKER_SERVICE_ACCOUNT="${GOTENBERG_INVOKER_SERVICE_ACCOUNT:-firebase-app-hosting-compute@${PROJECT_ID}.iam.gserviceaccount.com}"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/gotenberg"
IMAGE_TAG="${IMAGE_URI}:${RELEASE}"

gcloud auth print-access-token >/dev/null
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  --project="${PROJECT_ID}"

if ! gcloud artifacts repositories describe "${REPOSITORY}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Imagens de serviços internos do Coala One" \
    --project="${PROJECT_ID}"
fi

gcloud builds submit infra/gotenberg \
  --tag="${IMAGE_TAG}" \
  --project="${PROJECT_ID}"

IMAGE_DIGEST="$(gcloud artifacts docker images describe "${IMAGE_TAG}" \
  --project="${PROJECT_ID}" \
  --format='value(image_summary.digest)')"
if [[ -z "${IMAGE_DIGEST}" ]]; then
  echo "Não foi possível resolver o digest da imagem construída." >&2
  exit 1
fi

IMAGE_REFERENCE="${IMAGE_URI}@${IMAGE_DIGEST}"
gcloud run deploy "${SERVICE}" \
  --image="${IMAGE_REFERENCE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --no-allow-unauthenticated \
  --cpu=2 \
  --memory=2Gi \
  --concurrency=4 \
  --timeout=120 \
  --min=0 \
  --max=2 \
  --set-env-vars="LOG_STD_ENABLE_GCP_FIELDS=true" \
  --quiet

gcloud run services add-iam-policy-binding "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${INVOKER_SERVICE_ACCOUNT}" \
  --role="roles/run.invoker" \
  --quiet

SERVICE_URL="$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format='value(status.url)')"

printf '\nGotenberg implantado:\n'
printf '  serviço: %s\n' "${SERVICE}"
printf '  imagem:  %s\n' "${IMAGE_REFERENCE}"
printf '  URL:     %s\n\n' "${SERVICE_URL}"
printf 'Adicionar ao apphosting.yaml:\n'
printf '  - variable: DOCX_TO_PDF_URL\n'
printf '    value: "%s"\n' "${SERVICE_URL}"
printf '  - variable: DOCX_TO_PDF_AUDIENCE\n'
printf '    value: "%s"\n' "${SERVICE_URL}"
