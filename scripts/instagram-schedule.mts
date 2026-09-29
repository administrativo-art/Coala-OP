import { randomUUID } from "node:crypto";
import { access, open, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";

import {
  instagramScheduleInputSchema,
  type InstagramPublicationFormat,
} from "../src/features/instagram-scheduler/contracts.ts";

const DEFAULT_PROJECT_ID = "smart-converter-752gf";
const DEFAULT_BUCKET = "smart-converter-752gf.firebasestorage.app";
const DEFAULT_INSTAGRAM_ACCOUNT_ID = "17841476184089270";
const DEFAULT_WORKSPACE_ID = "coala";

type Args = {
  format?: string;
  at?: string;
  media: string[];
  caption?: string;
  captionFile?: string;
  shareToFeed: boolean;
  dryRun: boolean;
  id?: string;
  projectId: string;
  bucket: string;
  workspaceId: string;
  instagramAccountId: string;
  locationId?: string;
  locationName?: string;
};

function usage(): never {
  process.stderr.write(`Uso:
  npm run instagram:schedule -- --format feed_image --media ./foto.jpg --at 2026-09-29T10:00:00-03:00 --caption "Legenda"
  npm run instagram:schedule -- --format carousel --media ./1.jpg --media ./2.jpg --at 2026-09-29T10:00:00-03:00 --caption-file ./legenda.txt
  npm run instagram:schedule -- --format reel --media ./video.mp4 --at 2026-09-29T10:00:00-03:00
  npm run instagram:schedule -- --format story --media ./story.jpg --at 2026-09-29T10:00:00-03:00

Opções: --dry-run, --share-to-feed true|false, --location-id ID --location-name "Nome", --id ID\n`);
  process.exit(2);
}

function nextValue(argv: string[], index: number, option: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${option}.`);
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    media: [],
    shareToFeed: true,
    dryRun: false,
    projectId: process.env.FIREBASE_PROJECT_ID ?? DEFAULT_PROJECT_ID,
    bucket: process.env.FIREBASE_STORAGE_BUCKET ?? DEFAULT_BUCKET,
    workspaceId: process.env.WORKSPACE_ID ?? DEFAULT_WORKSPACE_ID,
    instagramAccountId: process.env.META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    switch (option) {
      case "--format": args.format = nextValue(argv, index++, option); break;
      case "--at": args.at = nextValue(argv, index++, option); break;
      case "--media": args.media.push(nextValue(argv, index++, option)); break;
      case "--caption": args.caption = nextValue(argv, index++, option); break;
      case "--caption-file": args.captionFile = nextValue(argv, index++, option); break;
      case "--share-to-feed": args.shareToFeed = nextValue(argv, index++, option) !== "false"; break;
      case "--id": args.id = nextValue(argv, index++, option); break;
      case "--project": args.projectId = nextValue(argv, index++, option); break;
      case "--bucket": args.bucket = nextValue(argv, index++, option); break;
      case "--workspace": args.workspaceId = nextValue(argv, index++, option); break;
      case "--instagram-account": args.instagramAccountId = nextValue(argv, index++, option); break;
      case "--location-id": args.locationId = nextValue(argv, index++, option); break;
      case "--location-name": args.locationName = nextValue(argv, index++, option); break;
      case "--dry-run": args.dryRun = true; break;
      case "--help": usage(); break;
      default: throw new Error(`Opção desconhecida: ${option}`);
    }
  }

  return args;
}

function normalizeFormat(value: string | undefined): InstagramPublicationFormat | undefined {
  const aliases: Record<string, InstagramPublicationFormat> = {
    feed: "feed_image",
    image: "feed_image",
    feed_image: "feed_image",
    carousel: "carousel",
    carrossel: "carousel",
    reel: "reel",
    reels: "reel",
    story: "story",
    stories: "story",
  };
  return value ? aliases[value.toLowerCase()] : undefined;
}

async function mediaType(path: string) {
  const extension = extname(path).toLowerCase();
  const handle = await open(path, "r");
  const header = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }

  if ([".jpg", ".jpeg"].includes(extension) && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { kind: "image" as const, contentType: "image/jpeg" };
  }
  const isIsoVideo = header.subarray(4, 8).toString("ascii") === "ftyp";
  if (extension === ".mp4" && isIsoVideo) return { kind: "video" as const, contentType: "video/mp4" };
  if (extension === ".mov" && isIsoVideo) return { kind: "video" as const, contentType: "video/quicktime" };
  throw new Error(`${basename(path)} não corresponde a um arquivo JPG, MP4 ou MOV válido.`);
}

function safeFileName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 180);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const format = normalizeFormat(args.format);
  if (!format || !args.at || args.media.length === 0) usage();
  if (args.caption && args.captionFile) throw new Error("Use --caption ou --caption-file, não os dois.");
  if ((args.locationId && !args.locationName) || (!args.locationId && args.locationName)) {
    throw new Error("Use --location-id e --location-name juntos.");
  }

  const scheduledAt = new Date(args.at);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error("Data inválida. Informe ISO 8601 com fuso, como 2026-09-29T10:00:00-03:00.");
  if (scheduledAt.getTime() < Date.now() + 120_000) throw new Error("Programe com pelo menos dois minutos de antecedência.");

  const caption = args.captionFile
    ? (await readFile(resolve(args.captionFile), "utf8")).trim()
    : (args.caption ?? "").trim();

  const media = await Promise.all(args.media.map(async (inputPath) => {
    const localPath = resolve(inputPath);
    await access(localPath);
    const fileStat = await stat(localPath);
    if (!fileStat.isFile()) throw new Error(`${localPath} não é um arquivo.`);
    const detected = await mediaType(localPath);
    if (detected.kind === "image" && fileStat.size > 8 * 1024 * 1024) {
      throw new Error(`${basename(localPath)} excede 8 MB.`);
    }
    if (detected.kind === "video" && fileStat.size > 300 * 1024 * 1024) {
      throw new Error(`${basename(localPath)} excede 300 MB.`);
    }
    const dimensions = detected.kind === "image" ? await sharp(localPath).metadata() : null;
    if (detected.kind === "image" && (!dimensions?.width || !dimensions.height)) {
      throw new Error(`Não foi possível identificar as dimensões de ${basename(localPath)}.`);
    }
    return {
      localPath,
      fileName: basename(localPath),
      sizeBytes: fileStat.size,
      width: dimensions?.width,
      height: dimensions?.height,
      ...detected,
    };
  }));

  const input = instagramScheduleInputSchema.parse({
    format,
    scheduledAt: scheduledAt.toISOString(),
    caption,
    media,
    shareToFeed: args.shareToFeed,
    location:
      args.locationId && args.locationName
        ? { id: args.locationId, name: args.locationName }
        : undefined,
  });

  console.log("Agendamento validado:", {
    format: input.format,
    scheduledAt: input.scheduledAt,
    media: input.media.map((item) => ({
      fileName: item.fileName,
      sizeBytes: item.sizeBytes,
      dimensions: item.width && item.height ? `${item.width}x${item.height}` : null,
    })),
    captionCharacters: input.caption.length,
    shareToFeed: input.shareToFeed,
    location: input.location?.name ?? null,
    dryRun: args.dryRun,
  });
  if (args.dryRun) return;

  const app = initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore(app, "coala");
  const bucket = getStorage(app).bucket(args.bucket);
  const ref = args.id
    ? db.collection("instagramScheduledPosts").doc(args.id)
    : db.collection("instagramScheduledPosts").doc();

  const uploadedPaths: string[] = [];
  const createdAt = Timestamp.now();
  await ref.create({
    workspace_id: args.workspaceId,
    instagramAccountId: args.instagramAccountId,
    format: input.format,
    status: "uploading",
    scheduledAt: Timestamp.fromDate(scheduledAt),
    caption: input.caption,
    shareToFeed: input.shareToFeed,
    location: input.location ?? null,
    media: [],
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
    createdBy: { source: "instagram-schedule-cli" },
  }).catch((error: unknown) => {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code.includes("already-exists") || code === "6") {
      throw new Error(`Já existe um agendamento com o ID ${ref.id}.`);
    }
    throw error;
  });

  try {
    const uploadedMedia = [];
    for (let index = 0; index < input.media.length; index += 1) {
      const item = input.media[index]!;
      const objectPath = `instagram/scheduled/${ref.id}/${String(index + 1).padStart(2, "0")}-${safeFileName(item.fileName)}`;
      const downloadToken = randomUUID();
      await bucket.upload(item.localPath, {
        destination: objectPath,
        resumable: item.sizeBytes >= 5 * 1024 * 1024,
        metadata: {
          contentType: item.contentType,
          cacheControl: "private, max-age=3600",
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      uploadedPaths.push(objectPath);
      uploadedMedia.push({
        kind: item.kind,
        contentType: item.contentType,
        fileName: item.fileName,
        sizeBytes: item.sizeBytes,
        width: item.width ?? null,
        height: item.height ?? null,
        objectPath,
        deliveryUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(args.bucket)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`,
      });
    }

    await ref.update({
      status: "scheduled",
      nextAttemptAt: Timestamp.fromDate(scheduledAt),
      wakeAt: Timestamp.fromDate(scheduledAt),
      media: uploadedMedia,
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    await Promise.allSettled(uploadedPaths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
    await ref.delete().catch(() => undefined);
    throw error;
  }

  console.log(`Agendamento criado com ID ${ref.id}.`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Falha ao criar o agendamento."}\n`);
  process.exitCode = 1;
});
