# Gotenberg 8.34.0, variante LibreOffice otimizada para Cloud Run.
# O digest fixa exatamente a imagem linux/amd64 publicada pelo projeto.
FROM gotenberg/gotenberg@sha256:fce81fe9f385be06fe3a8c8a90d8d8fbf77e21e6ebd93d060c306ff3cc59f522

USER root

# Cambria é a fonte declarada pelos modelos. Caladea mantém a métrica no
# LibreOffice Linux; Carlito permanece disponível somente para legados Calibri.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      fonts-crosextra-caladea \
      fonts-crosextra-carlito \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f \
    && fc-match -f '%{family}\\n' 'Cambria:style=Regular' | head -n 1 | grep -q '^Caladea' \
    && fc-match -f '%{family}\\n' 'Cambria:style=Bold' | head -n 1 | grep -q '^Caladea' \
    && fc-match -f '%{family}\\n' 'Cambria:style=Italic' | head -n 1 | grep -q '^Caladea' \
    && fc-match -f '%{family}\\n' 'Cambria:style=Bold Italic' | head -n 1 | grep -q '^Caladea' \
    && fc-match -f '%{family}\\n' 'Calibri:style=Regular' | head -n 1 | grep -q '^Carlito' \
    && fc-match -f '%{family}\\n' 'Calibri:style=Bold' | head -n 1 | grep -q '^Carlito' \
    && fc-match -f '%{family}\\n' 'Calibri:style=Italic' | head -n 1 | grep -q '^Carlito' \
    && fc-match -f '%{family}\\n' 'Calibri:style=Bold Italic' | head -n 1 | grep -q '^Carlito'

LABEL org.opencontainers.image.title="Coala One Gotenberg" \
      org.opencontainers.image.description="Conversor DOCX-PDF reprodutível do Coala One" \
      org.opencontainers.image.version="8.34.0-coala.2" \
      coala.gotenberg.base-digest="sha256:fce81fe9f385be06fe3a8c8a90d8d8fbf77e21e6ebd93d060c306ff3cc59f522" \
      coala.font.cambria-substitute="Caladea" \
      coala.font.calibri-substitute="Carlito"

USER gotenberg
