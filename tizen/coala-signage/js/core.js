/*
 * Regras do player sem dependência de tela nem de Tizen, para rodarem também nos testes (Node).
 * `isScheduleActive`, `resolveActiveSlide` e `getNextSlide` espelham `src/lib/signage.ts`;
 * `tests/unit/signage-tizen-app.test.ts` compara as duas implementações.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoalaSignageCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var CODE_LENGTH = 8;
  var MIN_SLIDE_MS = 3000;
  var DEFAULT_SLIDE_MS = 10000;
  var FILE_PREFIX = 'cs-';

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function getLocalDateKey(now) {
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function isScheduleActive(slide, now) {
    var s = slide.schedule;
    if (!s) return true;

    var currentDate = getLocalDateKey(now);
    var currentTime = pad(now.getHours()) + ':' + pad(now.getMinutes());

    if (s.startDate && currentDate < s.startDate) return false;
    if (s.endDate && currentDate > s.endDate) return false;

    if (s.startTime && s.endTime) {
      if (s.startTime < s.endTime) {
        if (currentTime < s.startTime || currentTime >= s.endTime) return false;
      } else if (currentTime < s.startTime && currentTime >= s.endTime) {
        // faixa que atravessa a meia-noite, ex.: 22:00 → 06:00
        return false;
      }
    } else if (s.startTime && currentTime < s.startTime) {
      return false;
    } else if (s.endTime && currentTime >= s.endTime) {
      return false;
    }

    return true;
  }

  function indexOfSlide(slides, slideId) {
    for (var i = 0; i < slides.length; i += 1) {
      if (slides[i].id === slideId) return i;
    }
    return -1;
  }

  function resolveActiveSlide(slides, activeSlideId) {
    if (!slides.length) return null;
    var index = indexOfSlide(slides, activeSlideId);
    return slides[index === -1 ? 0 : index];
  }

  function getNextSlide(slides, activeSlideId) {
    if (!slides.length) return null;
    return slides[(indexOfSlide(slides, activeSlideId) + 1) % slides.length];
  }

  function getSlideDurationMs(slide) {
    var duration = Number(slide.durationMs);
    return Math.max(duration > 0 ? duration : DEFAULT_SLIDE_MS, MIN_SLIDE_MS);
  }

  /** Só o que foi digitado e pertence ao alfabeto do código, em maiúsculas e no tamanho máximo. */
  function normalizeCode(input) {
    var upper = String(input || '').toUpperCase();
    var result = '';
    for (var i = 0; i < upper.length && result.length < CODE_LENGTH; i += 1) {
      if (CODE_ALPHABET.indexOf(upper.charAt(i)) !== -1) result += upper.charAt(i);
    }
    return result;
  }

  function isCompleteCode(code) {
    return normalizeCode(code) === code && code.length === CODE_LENGTH;
  }

  function slideNeedsMedia(slide) {
    return (slide.type === 'image' || slide.type === 'video') && Boolean(slide.assetUrl);
  }

  /** Nome do arquivo no disco do monitor: o último trecho do endereço, sem nada que o sistema de arquivos recuse. */
  function getAssetFileName(assetUrl) {
    var clean = String(assetUrl).split('?')[0].split('#')[0];
    var last = clean.substring(clean.lastIndexOf('/') + 1);
    try {
      last = decodeURIComponent(last);
    } catch (error) {
      // mantém o trecho como veio
    }
    return FILE_PREFIX + last.replace(/[^A-Za-z0-9._-]/g, '_');
  }

  function absoluteUrl(server, assetUrl) {
    if (/^https?:\/\//i.test(assetUrl)) return assetUrl;
    return String(server).replace(/\/+$/, '') + (assetUrl.charAt(0) === '/' ? '' : '/') + assetUrl;
  }

  /**
   * O que baixar e o que apagar para o disco ficar igual à playlist.
   * `manifest` é { [nomeDoArquivo]: { uri } } com o que já foi baixado por inteiro.
   */
  function planMediaSync(slides, manifest, server) {
    var wanted = {};
    var downloads = [];
    for (var i = 0; i < slides.length; i += 1) {
      var slide = slides[i];
      if (!slideNeedsMedia(slide)) continue;
      var fileName = getAssetFileName(slide.assetUrl);
      if (wanted[fileName]) continue;
      wanted[fileName] = true;
      if (!manifest[fileName]) downloads.push({ fileName: fileName, url: absoluteUrl(server, slide.assetUrl) });
    }

    var removals = [];
    for (var name in manifest) {
      if (Object.prototype.hasOwnProperty.call(manifest, name) && !wanted[name]) removals.push(name);
    }
    return { downloads: downloads, removals: removals, total: Object.keys(wanted).length };
  }

  /**
   * Slides que podem ir ao ar agora: dentro do agendamento e, quando têm mídia, com o arquivo no disco.
   * Sem disco (navegador comum), a mídia toca direto do servidor.
   */
  function getPlayableSlides(slides, manifest, now, options) {
    var hasStore = !options || options.hasStore !== false;
    var server = (options && options.server) || '';
    var playable = [];
    for (var i = 0; i < slides.length; i += 1) {
      var slide = slides[i];
      if (!isScheduleActive(slide, now)) continue;
      if (!slideNeedsMedia(slide)) {
        if (slide.type === 'text') playable.push({ slide: slide, src: null });
        continue;
      }
      if (!hasStore) {
        playable.push({ slide: slide, src: absoluteUrl(server, slide.assetUrl) });
        continue;
      }
      var entry = manifest[getAssetFileName(slide.assetUrl)];
      if (entry && entry.uri) playable.push({ slide: slide, src: entry.uri });
    }
    return playable;
  }

  /** Só troca de playlist quando a publicação recebida é mais nova que a que está no monitor. */
  function isNewerPublication(current, next) {
    if (!next || !next.updatedAt) return false;
    if (!current || !current.updatedAt) return true;
    return Date.parse(next.updatedAt) > Date.parse(current.updatedAt);
  }

  function msUntilHour(now, hour) {
    var target = new Date(now.getTime());
    target.setHours(hour, 0, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  return {
    CODE_ALPHABET: CODE_ALPHABET,
    CODE_LENGTH: CODE_LENGTH,
    FILE_PREFIX: FILE_PREFIX,
    absoluteUrl: absoluteUrl,
    getAssetFileName: getAssetFileName,
    getLocalDateKey: getLocalDateKey,
    getNextSlide: getNextSlide,
    getPlayableSlides: getPlayableSlides,
    getSlideDurationMs: getSlideDurationMs,
    isCompleteCode: isCompleteCode,
    isNewerPublication: isNewerPublication,
    isScheduleActive: isScheduleActive,
    msUntilHour: msUntilHour,
    normalizeCode: normalizeCode,
    planMediaSync: planMediaSync,
    resolveActiveSlide: resolveActiveSlide,
    slideNeedsMedia: slideNeedsMedia,
  };
});
