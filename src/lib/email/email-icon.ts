type EmailIconBoxOptions = {
  src: string;
  iconSize: number;
  boxSize: number;
  background: string;
  radius?: number;
};

/**
 * E-mail clients are inconsistent when centering inline images inside spans.
 * A fixed presentation table keeps the icon centered in Apple Mail, Gmail and
 * Outlook, including when the image is embedded through CID.
 */
export function renderEmailIconBox({
  src,
  iconSize,
  boxSize,
  background,
  radius = 8,
}: EmailIconBoxOptions) {
  const sourceName = src.split("/").at(-1)?.replace(/\.png$/i, "") ?? "icon";
  const backgroundName = background.replace("#", "").toLowerCase();
  const composedSrc = `https://op.coalashakes.com/email/icons/boxes/${sourceName}-${iconSize}-in-${boxSize}-${backgroundName}-r${radius}.png`;
  return `<img src="${composedSrc}" width="${boxSize}" height="${boxSize}" alt="" style="display:block;width:${boxSize}px;height:${boxSize}px;margin:0 auto;border:0" />`;
}
