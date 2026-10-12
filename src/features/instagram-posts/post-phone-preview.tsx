"use client";

import { useState } from "react";
import { Bookmark, Heart, Images, MessageCircle, MoreHorizontal, Send, Volume2 } from "lucide-react";

import { ProtectedMedia } from "@/features/instagram-scheduler/protected-media";
import { cn } from "@/lib/utils";

import type { InstagramEditorialPost } from "./contracts";

/* Simulação do aparelho: as cores abaixo reproduzem a interface do Instagram e a moldura do celular,
   por isso ficam fora dos tokens do guia (como nas prévias do detalhe da publicação). */

export const PHONE_WIDTH = 290;
export const PHONE_HEIGHT = 580;

const ACCOUNT = "coalashakes";

function MediaSlot({ post, index, className, eager }: { post: InstagramEditorialPost; index: number; className?: string; eager?: boolean }) {
  const media = post.media[index] ?? post.media[0];
  if (!media) {
    return (
      <div className={cn("grid place-items-center bg-[#f1ece6] px-6 text-center text-[11px] font-semibold leading-snug text-[#8a7566]", className)}>
        Falta enviar a arte
      </div>
    );
  }
  return (
    <ProtectedMedia
      url={media.previewUrl}
      kind={media.kind}
      alt={`Arte de ${post.title}`}
      className={cn("h-full w-full object-cover", className)}
      previewVideo
      eager={eager}
    />
  );
}

function FeedScreen({ post, index, onIndex }: { post: InstagramEditorialPost; index: number; onIndex?: (next: number) => void }) {
  const many = post.format === "carousel" && post.media.length > 1;
  return (
    <div className="flex h-full flex-col bg-white text-[#181818]">
      <div className="flex items-center gap-2 px-3 py-2.5 text-[11px]">
        <span className="h-7 w-7 rounded-full bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] p-[2px]"><span className="block h-full w-full rounded-full border-2 border-white bg-[#fde3ef]" /></span>
        <strong className="flex-1 leading-tight">{ACCOUNT}</strong>
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden bg-[#f3e8dc]">
        <MediaSlot post={post} index={index} eager />
        {many && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[9px] font-bold text-white">
            <Images className="h-3 w-3" aria-hidden="true" /> {index + 1}/{post.media.length}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 px-3 pb-1 pt-2.5">
        <Heart className="h-5 w-5" aria-hidden="true" />
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        <Send className="h-5 w-5" aria-hidden="true" />
        {many && (
          <div className="ml-auto flex gap-1" role="group" aria-label="Mídias do carrossel">
            {post.media.map((media, position) => (
              <button
                key={media.id}
                type="button"
                aria-label={`Mostrar mídia ${position + 1}`}
                aria-pressed={position === index}
                onClick={() => onIndex?.(position)}
                className={cn("h-1.5 w-1.5 rounded-full", position === index ? "bg-[#0095F6]" : "bg-[#d9d9d9]")}
              />
            ))}
          </div>
        )}
        <Bookmark className={cn("h-5 w-5", many ? "ml-0" : "ml-auto")} aria-hidden="true" />
      </div>
      <p className="line-clamp-3 px-3 pb-3 text-[11px] leading-[1.4]">
        <strong>{ACCOUNT}</strong> {post.caption || "Sem legenda."}
      </p>
    </div>
  );
}

function StoryScreen({ post, index, onIndex }: { post: InstagramEditorialPost; index: number; onIndex?: (next: number) => void }) {
  const total = Math.max(post.media.length, 1);
  return (
    <div className="relative h-full overflow-hidden bg-[#181818] text-white">
      <div className="absolute inset-0"><MediaSlot post={post} index={index} className="object-contain" eager /></div>
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent px-3 pb-10 pt-9">
        <div className="flex gap-1">
          {Array.from({ length: total }, (_, position) => (
            <span key={position} className="h-0.5 flex-1 rounded bg-white/45"><span className={cn("block h-full rounded", position <= index ? "w-full bg-white" : "w-0")} /></span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] font-extrabold">
          <span className="h-7 w-7 rounded-full border-2 border-white bg-[#fde3ef]" />
          <span>{ACCOUNT}</span>
          <span className="font-medium text-white/75">agora</span>
          <MoreHorizontal className="ml-auto h-4 w-4" aria-hidden="true" />
        </div>
        {post.storyMentions.length > 0 && <p className="mt-2 text-[10px] font-semibold text-white/85">{post.storyMentions.map((name) => `@${name}`).join(" ")}</p>}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-3 pb-4 pt-14">
        <span className="flex-1 rounded-full border border-white/80 px-3 py-2 text-[10px] font-semibold">Enviar mensagem</span>
        <Heart className="h-5 w-5" aria-hidden="true" />
        <Send className="h-5 w-5" aria-hidden="true" />
      </div>
      {total > 1 && (
        <>
          <button type="button" aria-label="Story anterior" disabled={index === 0} onClick={() => onIndex?.(index - 1)} className="absolute inset-y-16 left-0 w-1/3 disabled:cursor-default" />
          <button type="button" aria-label="Próximo Story" disabled={index >= total - 1} onClick={() => onIndex?.(index + 1)} className="absolute inset-y-16 right-0 w-1/3 disabled:cursor-default" />
        </>
      )}
    </div>
  );
}

function ReelScreen({ post }: { post: InstagramEditorialPost }) {
  return (
    <div className="relative h-full overflow-hidden bg-[#181818] text-white">
      <div className="absolute inset-0"><MediaSlot post={post} index={0} eager /></div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent px-4 pb-10 pt-10 text-[15px] font-extrabold">
        <span>Reels</span>
        <Volume2 className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 grid grid-cols-[1fr_auto] items-end gap-3 bg-gradient-to-t from-black/75 to-transparent px-3 pb-4 pt-24">
        <div className="min-w-0 text-[10px] leading-[1.4]">
          <div className="mb-2 flex items-center gap-2 font-extrabold"><span className="h-7 w-7 rounded-full border border-white bg-[#fde3ef]" />{ACCOUNT}</div>
          {post.caption && <p className="line-clamp-3 whitespace-pre-wrap">{post.caption}</p>}
        </div>
        <div className="flex flex-col items-center gap-4">
          <Heart className="h-5 w-5" aria-hidden="true" />
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          <Send className="h-5 w-5" aria-hidden="true" />
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/** Barra de status do aparelho (hora e sinal), abaixo do entalhe, para o conteúdo não ficar atrás dele. */
function StatusBar({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex h-[34px] items-end justify-between px-6 pb-1 text-[11px] font-bold", className)}>
      <span>9:41</span>
      <span className="flex items-center gap-1">
        <span className="flex items-end gap-px">
          <i className="block h-[4px] w-[2px] rounded-sm bg-current" /><i className="block h-[6px] w-[2px] rounded-sm bg-current" /><i className="block h-[8px] w-[2px] rounded-sm bg-current" /><i className="block h-[10px] w-[2px] rounded-sm bg-current opacity-40" />
        </span>
        <span className="ml-1 block h-[9px] w-[18px] rounded-[3px] border border-current p-px"><i className="block h-full w-3/4 rounded-[1px] bg-current" /></span>
      </span>
    </div>
  );
}

/** Celular completo (290×580) com a interface do Instagram do formato do post. */
function PhoneFrame({ post, index, onIndex }: { post: InstagramEditorialPost; index: number; onIndex?: (next: number) => void }) {
  return (
    <div className="relative rounded-[40px] bg-[#283137] p-2.5 shadow-[0_20px_40px_rgba(24,24,24,.22)]" style={{ width: PHONE_WIDTH, height: PHONE_HEIGHT }}>
      <span aria-hidden="true" className="absolute left-1/2 top-[14px] z-10 h-[18px] w-[70px] -translate-x-1/2 rounded-full bg-[#101418]" />
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[30px] bg-white">
        {/* No Story e no Reel a arte vai até o topo e a barra de status fica por cima, em branco. */}
        <StatusBar className={post.format === "feed_image" || post.format === "carousel" ? "shrink-0 text-[#181818]" : "absolute inset-x-0 top-0 z-20 text-white"} />
        <div className="min-h-0 flex-1">
          {post.format === "story" ? <StoryScreen post={post} index={index} onIndex={onIndex} />
            : post.format === "reel" ? <ReelScreen post={post} />
            : <FeedScreen post={post} index={index} onIndex={onIndex} />}
        </div>
      </div>
    </div>
  );
}

/** Miniatura do celular para listas: o mesmo aparelho, reduzido por escala (sem interação). */
export function PostPhoneThumb({ post, width = 92 }: { post: InstagramEditorialPost; width?: number }) {
  const scale = width / PHONE_WIDTH;
  return (
    <div aria-hidden="true" className="pointer-events-none shrink-0 overflow-hidden" style={{ width, height: PHONE_HEIGHT * scale }}>
      <div style={{ width: PHONE_WIDTH, height: PHONE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <PhoneFrame post={post} index={0} />
      </div>
    </div>
  );
}

/** Celular interativo (troca de mídia em carrosséis e Stories em sequência); `scale` o ajusta à altura disponível. */
export function PostPhonePreview({ post, scale = 1 }: { post: InstagramEditorialPost; scale?: number }) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(post.media.length - 1, 0));
  return (
    <div className="flex flex-col items-center gap-2">
      <div style={{ width: PHONE_WIDTH * scale, height: PHONE_HEIGHT * scale }}>
        <div style={{ width: PHONE_WIDTH, height: PHONE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <PhoneFrame post={post} index={safeIndex} onIndex={setIndex} />
        </div>
      </div>
      <p className="text-center text-[11px] text-ds-ink-muted">Prévia aproximada no aparelho.</p>
    </div>
  );
}
