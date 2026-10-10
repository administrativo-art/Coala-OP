/*
 * Coala Signage para monitores Samsung (Tizen/SSSP).
 * Pareia a tela pelo código de acesso, baixa a playlist publicada e as mídias para o disco
 * e segue tocando sem internet. A cada minuto avisa o Coala que está no ar e, na resposta,
 * descobre se há publicação nova.
 */
(function (root) {
  'use strict';

  var Core = root.CoalaSignageCore;
  var Media = root.CoalaSignageMedia;
  var CONFIG = root.COALA_SIGNAGE_CONFIG || { server: '', version: 'dev' };

  var SCREEN_KEY = 'coala-signage:screen';
  var PLAYLIST_KEY = 'coala-signage:playlist';
  var NEXT_PLAYLIST_KEY = 'coala-signage:playlist-next';
  var SYNC_MS = 60000;
  var SCHEDULE_TICK_MS = 30000;
  var REQUEST_TIMEOUT_MS = 30000;
  var MEDIA_READY_TIMEOUT_MS = 10000;
  var DAILY_RELOAD_HOUR = 4;
  var INFO_AUTO_CLOSE_MS = 30000;
  // Publicação nova com mídia que não baixa: depois destas tentativas ela entra no ar sem o slide.
  var MAX_PENDING_ATTEMPTS = 5;
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACKSPACE: 8, BACK: 10009 };

  var el = {};
  var settings = null;
  var playlist = null;
  var nextPlaylist = null;
  var pendingAttempts = 0;
  var syncing = false;
  var lastContactAt = null;
  var lastError = null;
  var downloadProgress = null;

  var layers = [];
  var frontIndex = 0;
  var current = null;
  var loadingSignature = null;
  var positionSlideId = null;
  var showToken = 0;
  var rotationTimer = null;
  var failuresBySlide = {};

  var pairingCode = '';
  var pairingFocus = { row: 0, col: 0 };
  var pairingBusy = false;
  var infoFocus = 0;
  var infoConfirming = false;
  var infoTimer = null;

  // ---------- armazenamento ----------

  function readJson(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // segue com o valor em memória
    }
  }

  // ---------- servidor ----------

  function request(path, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
    var init = options || {};
    init.cache = 'no-store';
    if (controller) init.signal = controller.signal;

    return fetch(CONFIG.server + path, init).then(function (response) {
      if (timer) clearTimeout(timer);
      if (!response.ok) {
        var error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      return response.json();
    }, function (error) {
      if (timer) clearTimeout(timer);
      throw error;
    });
  }

  // `text/plain` mantém o POST como requisição simples: o app roda em `file://` e não depende de preflight.
  function post(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
    });
  }

  function describeError(error) {
    if (error && error.status === 403) return 'Código recusado. Aperte OK e conecte a tela de novo.';
    if (error && error.status === 404) return 'Esta tela não existe mais no Coala. Aperte OK e conecte de novo.';
    return 'Sem contato com o Coala. Tocando o que está no monitor.';
  }

  // ---------- sincronização ----------

  function sendHeartbeat() {
    return post('/api/signage/heartbeat', {
      screenId: settings.screenId,
      token: settings.token,
      currentSlideId: current ? current.slide.id : undefined,
      updatedAt: playlist ? playlist.updatedAt : undefined,
      status: 'app',
      appVersion: CONFIG.version,
    });
  }

  function fetchPlaylist() {
    var path = '/api/signage/public/' + encodeURIComponent(settings.screenId) + '?token=' + encodeURIComponent(settings.token);
    return request(path).then(function (published) {
      if (!published || !Array.isArray(published.slides)) return;
      if (!Core.isNewerPublication(playlist, published)) return;
      nextPlaylist = published;
      pendingAttempts = 0;
      writeJson(NEXT_PLAYLIST_KEY, nextPlaylist);
    });
  }

  function downloadAll(downloads) {
    var failures = 0;
    var index = 0;

    function next() {
      if (index >= downloads.length) return Promise.resolve(failures);
      var item = downloads[index];
      downloadProgress = { done: index, total: downloads.length, percent: 0 };
      renderIdle();
      return Media.download(item.url, item.fileName, function (received, total) {
        downloadProgress = { done: index, total: downloads.length, percent: total > 0 ? Math.floor((received / total) * 100) : 0 };
        renderIdle();
      }).then(null, function () {
        failures += 1;
      }).then(function () {
        index += 1;
        return next();
      });
    }

    return next().then(function (count) {
      downloadProgress = null;
      return count;
    });
  }

  function promoteNextPlaylist() {
    playlist = nextPlaylist;
    nextPlaylist = null;
    pendingAttempts = 0;
    writeJson(PLAYLIST_KEY, playlist);
    writeJson(NEXT_PLAYLIST_KEY, null);
    failuresBySlide = {};
    refreshPlayback(true);
  }

  /** Baixa o que falta. A publicação nova só entra no ar com as mídias dela no disco. */
  function ensureMedia() {
    var target = nextPlaylist || playlist;
    if (!target) return Promise.resolve();
    if (!Media.isAvailable()) {
      if (nextPlaylist) promoteNextPlaylist();
      return Promise.resolve();
    }

    var plan = Core.planMediaSync(target.slides, Media.getManifest(), CONFIG.server);
    return downloadAll(plan.downloads).then(function (failures) {
      if (nextPlaylist) {
        pendingAttempts += 1;
        if (!failures || !playlist || pendingAttempts >= MAX_PENDING_ATTEMPTS) promoteNextPlaylist();
      }
      if (nextPlaylist || !playlist) return null;
      // Só apaga do disco depois que a publicação que usa os arquivos saiu do ar.
      var removals = Core.planMediaSync(playlist.slides, Media.getManifest(), CONFIG.server).removals;
      return removals.reduce(function (chain, fileName) {
        return chain.then(function () { return Media.remove(fileName); });
      }, Promise.resolve());
    });
  }

  function syncCycle() {
    if (syncing || !settings) return;
    syncing = true;
    sendHeartbeat()
      .then(function (result) {
        lastContactAt = Date.now();
        lastError = null;
        var publishedAt = result && result.publishedAt;
        var known = (nextPlaylist || playlist || {}).updatedAt;
        if (publishedAt && publishedAt !== known) return fetchPlaylist();
        return null;
      })
      .then(null, function (error) {
        lastError = describeError(error);
      })
      .then(ensureMedia)
      .then(null, function () {})
      .then(function () {
        syncing = false;
        refreshPlayback(false);
        if (!el.info.hidden) renderInfo();
      });
  }

  // ---------- reprodução ----------

  function getPlayable() {
    if (!playlist) return [];
    return Core.getPlayableSlides(playlist.slides, Media.getManifest(), new Date(), {
      hasStore: Media.isAvailable(),
      server: CONFIG.server,
    });
  }

  function signatureOf(entry) {
    var slide = entry.slide;
    return JSON.stringify([slide.id, slide.type, entry.src, slide.text || null, slide.background || null, slide.durationMs]);
  }

  function findEntry(playable, slideId) {
    for (var i = 0; i < playable.length; i += 1) {
      if (playable[i].slide.id === slideId) return playable[i];
    }
    return null;
  }

  function slidesOf(playable) {
    return playable.map(function (entry) { return entry.slide; });
  }

  // O monitor decodifica um vídeo por vez: o anterior precisa ser solto antes de o próximo carregar.
  function releaseLayer(layer) {
    var videos = layer.getElementsByTagName('video');
    for (var i = 0; i < videos.length; i += 1) {
      try {
        videos[i].pause();
        videos[i].removeAttribute('src');
        videos[i].load();
      } catch (error) {
        // elemento já descartado
      }
    }
    layer.textContent = '';
  }

  function stopPlayback() {
    showToken += 1;
    if (rotationTimer) clearTimeout(rotationTimer);
    rotationTimer = null;
    current = null;
    loadingSignature = null;
    layers.forEach(function (layer) {
      layer.classList.remove('visible');
      releaseLayer(layer);
    });
  }

  function handleSlideFailure(entry, token) {
    if (token !== showToken) return;
    loadingSignature = null;
    var slideId = entry.slide.id;
    failuresBySlide[slideId] = (failuresBySlide[slideId] || 0) + 1;
    // Arquivo que falha duas vezes é tratado como corrompido: sai do disco e é baixado de novo.
    if (failuresBySlide[slideId] >= 2 && Media.isAvailable() && Core.slideNeedsMedia(entry.slide)) {
      failuresBySlide[slideId] = 0;
      Media.remove(Core.getAssetFileName(entry.slide.assetUrl));
    }
    positionSlideId = slideId;
    if (rotationTimer) clearTimeout(rotationTimer);
    rotationTimer = setTimeout(function () { advance(slideId); }, 2000);
  }

  function show(entry) {
    var token = ++showToken;
    var slide = entry.slide;
    var signature = signatureOf(entry);
    var front = layers[frontIndex];
    var back = layers[1 - frontIndex];
    var settled = false;
    var readyTimer = null;

    if (rotationTimer) clearTimeout(rotationTimer);
    loadingSignature = signature;
    releaseLayer(back);
    if (slide.type === 'video' || (current && current.slide.type === 'video')) {
      front.classList.remove('visible');
      releaseLayer(front);
    }

    function commit(video) {
      if (settled || token !== showToken) return;
      settled = true;
      if (readyTimer) clearTimeout(readyTimer);
      back.classList.add('visible');
      front.classList.remove('visible');
      frontIndex = 1 - frontIndex;
      setTimeout(function () {
        if (token === showToken) releaseLayer(front);
      }, 500);
      current = { slide: slide, signature: signature };
      loadingSignature = null;
      positionSlideId = slide.id;
      failuresBySlide[slide.id] = 0;
      el.message.hidden = true;
      if (video) {
        var playing = video.play();
        if (playing && playing.catch) playing.catch(function () {});
      }
      rotationTimer = setTimeout(function () { advance(slide.id); }, Core.getSlideDurationMs(slide));
    }

    function fail() {
      if (settled || token !== showToken) return;
      settled = true;
      if (readyTimer) clearTimeout(readyTimer);
      releaseLayer(back);
      handleSlideFailure(entry, token);
    }

    if (slide.type === 'text') {
      var text = document.createElement('div');
      text.className = 'slide-text';
      text.style.background = slide.background || '#0f172a';
      text.textContent = slide.text || '';
      back.appendChild(text);
      commit(null);
      return;
    }

    readyTimer = setTimeout(fail, MEDIA_READY_TIMEOUT_MS);
    if (slide.type === 'image') {
      var image = document.createElement('img');
      image.alt = '';
      image.onload = function () { commit(null); };
      image.onerror = fail;
      back.appendChild(image);
      image.src = entry.src;
      return;
    }

    var video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.oncanplay = function () { commit(video); };
    video.onerror = fail;
    back.appendChild(video);
    video.src = entry.src;
    video.load();
  }

  function advance(fromSlideId) {
    var playable = getPlayable();
    if (!playable.length) {
      stopPlayback();
      renderIdle();
      return;
    }
    var nextSlide = Core.getNextSlide(slidesOf(playable), fromSlideId);
    var entry = findEntry(playable, nextSlide.id);
    if (current && current.signature === signatureOf(entry)) {
      // Único slide no ar: continua na tela (o vídeo já está em loop).
      rotationTimer = setTimeout(function () { advance(nextSlide.id); }, Core.getSlideDurationMs(nextSlide));
      return;
    }
    show(entry);
  }

  function refreshPlayback(restart) {
    var playable = getPlayable();
    if (!playable.length) {
      stopPlayback();
      renderIdle();
      return;
    }
    var active = Core.resolveActiveSlide(slidesOf(playable), restart ? null : positionSlideId);
    var entry = findEntry(playable, active.id);
    var signature = signatureOf(entry);
    if (loadingSignature === signature || (current && current.signature === signature)) return;
    // Outro slide já está carregando ou esperando a vez: a rotação segue por conta própria.
    if (!restart && (loadingSignature || (rotationTimer && !current))) return;
    show(entry);
  }

  // ---------- telas de apoio ----------

  function showMessage(title, text) {
    el.messageTitle.textContent = title;
    el.messageText.textContent = text;
    el.message.hidden = false;
  }

  /** O que aparece quando não há slide no ar. Fora do horário agendado a tela fica preta, sem aviso. */
  function renderIdle() {
    if (!settings || current || loadingSignature) return;
    if (!el.pairing.hidden) return;

    if (downloadProgress) {
      showMessage('Baixando o conteúdo', (downloadProgress.done + 1) + ' de ' + downloadProgress.total + ' · ' + downloadProgress.percent + '%');
      return;
    }
    var target = playlist || nextPlaylist;
    if (!target) {
      showMessage(
        lastContactAt ? 'Nada publicado para esta tela' : 'Conectando ao Coala',
        lastContactAt ? 'Monte a playlist em Coala Signage e publique.' : (lastError || 'Aguarde um instante.')
      );
      return;
    }
    if (!target.slides.length) {
      showMessage('Playlist vazia', 'Adicione slides em Coala Signage e publique.');
      return;
    }
    var scheduled = target.slides.filter(function (slide) { return Core.isScheduleActive(slide, new Date()); });
    if (!scheduled.length) {
      el.message.hidden = true;
      return;
    }
    showMessage('Conteúdo ainda não baixado', lastError || 'O monitor vai baixar as mídias assim que tiver internet.');
  }

  function formatDateTime(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'desconhecida';
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + '/' + date.getFullYear() + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function renderInfo() {
    var total = playlist ? playlist.slides.length : 0;
    var mediaPlan = playlist ? Core.planMediaSync(playlist.slides, Media.getManifest(), CONFIG.server) : { total: 0, downloads: [] };
    var lines = [
      ['Situação', lastError || (lastContactAt ? 'Conectado · último contato ' + formatDateTime(lastContactAt) : 'Conectando…')],
      ['Publicação', playlist ? formatDateTime(playlist.updatedAt) : 'nenhuma'],
      ['Slides', getPlayable().length + ' no ar de ' + total],
      ['Mídias', Media.isAvailable() ? (mediaPlan.total - mediaPlan.downloads.length) + ' de ' + mediaPlan.total + ' no monitor' : 'tocando direto da internet'],
      ['Código', settings ? settings.token : '—'],
      ['App', 'versão ' + CONFIG.version],
    ];
    if (nextPlaylist) lines.splice(2, 0, ['Nova publicação', 'baixando as mídias']);

    el.infoTitle.textContent = settings ? [settings.kioskName, settings.screenName].filter(Boolean).join(' · ') : '';
    el.infoLines.textContent = '';
    lines.forEach(function (line) {
      var term = document.createElement('dt');
      var value = document.createElement('dd');
      term.textContent = line[0];
      value.textContent = line[1];
      el.infoLines.appendChild(term);
      el.infoLines.appendChild(value);
    });
    el.infoUnpair.textContent = infoConfirming ? 'Confirmar troca' : 'Trocar de tela';
    el.infoClose.classList.toggle('focused', infoFocus === 0);
    el.infoUnpair.classList.toggle('focused', infoFocus === 1);
  }

  function armInfoTimer() {
    if (infoTimer) clearTimeout(infoTimer);
    infoTimer = setTimeout(closeInfo, INFO_AUTO_CLOSE_MS);
  }

  function openInfo() {
    infoFocus = 0;
    infoConfirming = false;
    el.info.hidden = false;
    renderInfo();
    armInfoTimer();
  }

  function closeInfo() {
    if (infoTimer) clearTimeout(infoTimer);
    infoTimer = null;
    el.info.hidden = true;
  }

  function unpair() {
    closeInfo();
    stopPlayback();
    settings = null;
    playlist = null;
    nextPlaylist = null;
    lastContactAt = null;
    lastError = null;
    positionSlideId = null;
    writeJson(SCREEN_KEY, null);
    writeJson(PLAYLIST_KEY, null);
    writeJson(NEXT_PLAYLIST_KEY, null);
    Media.clear();
    openPairing();
  }

  function pressInfoButton() {
    if (infoFocus === 0) {
      closeInfo();
      return;
    }
    if (!infoConfirming) {
      infoConfirming = true;
      renderInfo();
      return;
    }
    unpair();
  }

  // ---------- pareamento ----------

  function keypadRows() {
    var rows = [];
    for (var i = 0; i < Core.CODE_ALPHABET.length; i += 8) {
      rows.push(Core.CODE_ALPHABET.substr(i, 8).split('').map(function (char) { return { label: char, char: char }; }));
    }
    rows.push([{ label: 'Apagar', action: 'erase' }, { label: 'Conectar', action: 'submit' }]);
    return rows;
  }

  function setPairingStatus(text, neutral) {
    el.pairingStatus.textContent = text || '';
    el.pairingStatus.classList.toggle('neutral', Boolean(neutral));
  }

  function renderPairing() {
    var boxes = el.codeBoxes.children;
    for (var i = 0; i < boxes.length; i += 1) {
      boxes[i].textContent = pairingCode.charAt(i);
      boxes[i].classList.toggle('filled', i < pairingCode.length);
    }
    var buttons = el.keypad.children;
    for (var j = 0; j < buttons.length; j += 1) {
      var button = buttons[j];
      button.classList.toggle('focused', Number(button.getAttribute('data-row')) === pairingFocus.row && Number(button.getAttribute('data-col')) === pairingFocus.col);
    }
  }

  function submitPairing() {
    if (pairingBusy) return;
    if (!Core.isCompleteCode(pairingCode)) {
      setPairingStatus('O código tem ' + Core.CODE_LENGTH + ' caracteres.');
      return;
    }
    pairingBusy = true;
    setPairingStatus('Conectando…', true);
    post('/api/signage/pair', { code: pairingCode }).then(function (result) {
      pairingBusy = false;
      if (!result || !result.found) {
        setPairingStatus('Código não encontrado. Confira em Coala Signage, no card “Conectar a tela”.');
        return;
      }
      settings = { screenId: result.screenId, token: pairingCode, screenName: result.screenName || '', kioskName: result.kioskName || '' };
      writeJson(SCREEN_KEY, settings);
      el.pairing.hidden = true;
      showMessage('Tela conectada', [settings.kioskName, settings.screenName].filter(Boolean).join(' · '));
      syncCycle();
    }, function (error) {
      pairingBusy = false;
      setPairingStatus(error && error.status === 429
        ? 'Muitas tentativas. Aguarde um minuto e tente de novo.'
        : 'Sem contato com o Coala. Confira a internet do monitor.');
    });
  }

  function pressPairingKey(key) {
    if (pairingBusy) return;
    if (key.char) {
      pairingCode = Core.normalizeCode(pairingCode + key.char);
      setPairingStatus('');
      // Código completo: o foco vai para "Conectar".
      if (pairingCode.length === Core.CODE_LENGTH) pairingFocus = { row: keypadRows().length - 1, col: 1 };
    } else if (key.action === 'erase') {
      pairingCode = pairingCode.slice(0, -1);
      setPairingStatus('');
    } else if (key.action === 'submit') {
      submitPairing();
    }
    renderPairing();
  }

  function movePairingFocus(dRow, dCol) {
    var rows = keypadRows();
    var last = rows.length - 1;
    var row = Math.min(Math.max(pairingFocus.row + dRow, 0), last);
    var col = pairingFocus.col;
    // A última linha tem dois botões largos, cada um sob quatro teclas.
    if (row === last && pairingFocus.row !== last) col = col < 4 ? 0 : 1;
    else if (row !== last && pairingFocus.row === last) col = col === 0 ? 1 : 5;
    col = Math.min(Math.max(col + dCol, 0), rows[row].length - 1);
    pairingFocus = { row: row, col: col };
    renderPairing();
  }

  function buildPairing() {
    for (var i = 0; i < Core.CODE_LENGTH; i += 1) el.codeBoxes.appendChild(document.createElement('span'));
    keypadRows().forEach(function (row, rowIndex) {
      row.forEach(function (key, colIndex) {
        var button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.textContent = key.label;
        button.setAttribute('data-row', String(rowIndex));
        button.setAttribute('data-col', String(colIndex));
        if (key.action) button.className = 'wide';
        button.onclick = function () {
          pairingFocus = { row: rowIndex, col: colIndex };
          pressPairingKey(key);
        };
        el.keypad.appendChild(button);
      });
    });
    el.pairingVersion.textContent = 'versão ' + CONFIG.version;
  }

  function openPairing() {
    pairingCode = '';
    pairingFocus = { row: 0, col: 0 };
    pairingBusy = false;
    setPairingStatus('');
    el.message.hidden = true;
    el.pairing.hidden = false;
    renderPairing();
  }

  // ---------- controle remoto e teclado ----------

  function onKeyDown(event) {
    var code = event.keyCode;

    if (!el.pairing.hidden) {
      if (code === KEY.LEFT) movePairingFocus(0, -1);
      else if (code === KEY.RIGHT) movePairingFocus(0, 1);
      else if (code === KEY.UP) movePairingFocus(-1, 0);
      else if (code === KEY.DOWN) movePairingFocus(1, 0);
      else if (code === KEY.ENTER) pressPairingKey(keypadRows()[pairingFocus.row][pairingFocus.col]);
      else if (code === KEY.BACKSPACE || code === KEY.BACK) pressPairingKey({ action: 'erase' });
      else if (event.key && event.key.length === 1 && Core.normalizeCode(event.key)) pressPairingKey({ char: Core.normalizeCode(event.key) });
      else return;
      event.preventDefault();
      return;
    }

    if (!el.info.hidden) {
      armInfoTimer();
      if (code === KEY.LEFT || code === KEY.RIGHT) {
        infoFocus = infoFocus === 0 ? 1 : 0;
        infoConfirming = false;
        renderInfo();
      } else if (code === KEY.ENTER) {
        pressInfoButton();
      } else if (code === KEY.BACK) {
        closeInfo();
      } else {
        return;
      }
      event.preventDefault();
      return;
    }

    if (code === KEY.ENTER && settings) {
      openInfo();
      event.preventDefault();
    } else if (code === KEY.BACK) {
      // Voltar não fecha o app durante a reprodução.
      event.preventDefault();
    }
  }

  // ---------- início ----------

  function keepScreenOn() {
    try {
      root.webapis.appcommon.setScreenSaver(root.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
    } catch (error) {
      // fora do Tizen, ou monitor que já não usa protetor de tela
    }
  }

  function start() {
    el = {
      message: document.getElementById('message'),
      messageTitle: document.getElementById('message-title'),
      messageText: document.getElementById('message-text'),
      pairing: document.getElementById('pairing'),
      pairingStatus: document.getElementById('pairing-status'),
      pairingVersion: document.getElementById('pairing-version'),
      codeBoxes: document.getElementById('code-boxes'),
      keypad: document.getElementById('keypad'),
      info: document.getElementById('info'),
      infoTitle: document.getElementById('info-title'),
      infoLines: document.getElementById('info-lines'),
      infoClose: document.getElementById('info-close'),
      infoUnpair: document.getElementById('info-unpair'),
    };
    layers = [document.getElementById('layer-a'), document.getElementById('layer-b')];

    buildPairing();
    el.infoClose.onclick = function () { infoFocus = 0; pressInfoButton(); };
    el.infoUnpair.onclick = function () { infoFocus = 1; pressInfoButton(); };
    document.addEventListener('keydown', onKeyDown);
    keepScreenOn();

    settings = readJson(SCREEN_KEY);
    playlist = readJson(PLAYLIST_KEY);
    nextPlaylist = readJson(NEXT_PLAYLIST_KEY);
    if (settings && !(settings.screenId && settings.token)) settings = null;

    Media.init().then(function () {
      if (!settings) {
        openPairing();
      } else {
        refreshPlayback(true);
        syncCycle();
      }
      setInterval(syncCycle, SYNC_MS);
      setInterval(function () { refreshPlayback(false); }, SCHEDULE_TICK_MS);
      // Recarga diária de madrugada; o app é local, então funciona mesmo sem internet.
      setTimeout(function () { root.location.reload(); }, Core.msUntilHour(new Date(), DAILY_RELOAD_HOUR));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof self !== 'undefined' ? self : this);
