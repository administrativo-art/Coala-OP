export const PUBLIC_RECRUITMENT_HOST = "vagas.coalashakes.com";

function cleanHost(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();
}

function forwardedHosts(value: string) {
  return value
    .split(",")
    .flatMap((entry) => entry.split(";"))
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase().startsWith("host="))
    .map((part) => part.slice(5).replace(/^"|"$/g, ""));
}

export function getRequestHosts(headersList: Pick<Headers, "get">) {
  const values = [
    headersList.get("x-forwarded-host"),
    headersList.get("x-original-host"),
    headersList.get("x-host"),
    headersList.get("host"),
  ];
  const forwarded = headersList.get("forwarded");

  if (forwarded) {
    values.push(...forwardedHosts(forwarded));
  }

  return values
    .flatMap((value) => (value ? value.split(",") : []))
    .map(cleanHost)
    .filter(Boolean);
}

export function isPublicRecruitmentHost(host: string) {
  return cleanHost(host) === PUBLIC_RECRUITMENT_HOST;
}

export function isPublicRecruitmentRequest(headersList: Pick<Headers, "get">) {
  return getRequestHosts(headersList).includes(PUBLIC_RECRUITMENT_HOST);
}
