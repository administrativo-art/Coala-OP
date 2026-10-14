/*
 * Disco do monitor: baixa as mídias com `tizen.download` e guarda em `tizen.filesystem`,
 * para a playlist tocar sem internet. Fora do Tizen (navegador comum) fica indisponível e o
 * player usa o endereço do servidor direto.
 */
(function (root) {
  'use strict';

  var Core = root.CoalaSignageCore;
  var ROOTS = ['wgt-private', 'downloads'];
  var ROOT_KEY = 'coala-signage:media-root';
  var PROVEN_KEY = 'coala-signage:media-root-proven';
  var MANIFEST_KEY = 'coala-signage:media';
  var STALL_MS = 120000;

  var available = typeof tizen !== 'undefined' && Boolean(tizen.filesystem) && Boolean(tizen.download);
  var rootName = null;
  var rootDir = null;
  var manifest = {};

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveManifest() {
    try {
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
    } catch (error) {
      // sem espaço no localStorage: o manifesto é refeito a partir do disco no próximo início
    }
  }

  function resolvePath(path, mode) {
    return new Promise(function (resolve, reject) {
      try {
        tizen.filesystem.resolve(path, resolve, reject, mode || 'r');
      } catch (error) {
        reject(error);
      }
    });
  }

  function listDir(dir) {
    return new Promise(function (resolve, reject) {
      try {
        dir.listFiles(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  function deleteFromDir(dir, file) {
    return new Promise(function (resolve) {
      try {
        dir.deleteFile(file.fullPath, resolve, function () { resolve(); });
      } catch (error) {
        resolve();
      }
    });
  }

  function openRoot(name) {
    return resolvePath(name, 'rw').then(function (dir) {
      rootName = name;
      rootDir = dir;
      try {
        localStorage.setItem(ROOT_KEY, name);
      } catch (error) {
        // segue com a pasta em memória
      }
    });
  }

  function openFirstRoot(candidates) {
    if (!candidates.length) return Promise.reject(new Error('Nenhuma pasta gravável no monitor.'));
    return openRoot(candidates[0]).catch(function () {
      return openFirstRoot(candidates.slice(1));
    });
  }

  function findOurFiles() {
    return listDir(rootDir).then(function (files) {
      var ours = {};
      for (var i = 0; i < files.length; i += 1) {
        var file = files[i];
        if (!file.isDirectory && file.name.indexOf(Core.FILE_PREFIX) === 0) ours[file.name] = file;
      }
      return ours;
    });
  }

  /**
   * Confere o manifesto com o disco: some com o que não existe mais e apaga do disco o que
   * não está no manifesto (download interrompido ou mídia de outra playlist).
   */
  function reconcile() {
    return findOurFiles().then(function (files) {
      var deletions = [];
      var kept = {};
      var name;
      for (name in manifest) {
        if (!Object.prototype.hasOwnProperty.call(manifest, name)) continue;
        var file = files[manifest[name].file];
        if (file && file.fileSize > 0) kept[name] = { file: file.name, uri: file.toURI(), size: file.fileSize };
      }
      var referenced = {};
      for (name in kept) {
        if (Object.prototype.hasOwnProperty.call(kept, name)) referenced[kept[name].file] = true;
      }
      for (name in files) {
        if (Object.prototype.hasOwnProperty.call(files, name) && !referenced[name]) deletions.push(deleteFromDir(rootDir, files[name]));
      }
      manifest = kept;
      saveManifest();
      return Promise.all(deletions);
    });
  }

  function init() {
    if (!available) return Promise.resolve(false);
    manifest = readJson(MANIFEST_KEY, {});
    var stored = null;
    try {
      stored = localStorage.getItem(ROOT_KEY);
    } catch (error) {
      stored = null;
    }
    var candidates = stored && ROOTS.indexOf(stored) !== -1
      ? [stored].concat(ROOTS.filter(function (name) { return name !== stored; }))
      : ROOTS.slice();
    return openFirstRoot(candidates).then(reconcile).then(function () { return true; }).catch(function () {
      available = false;
      return false;
    });
  }

  function startDownload(url, fileName, onProgress) {
    return new Promise(function (resolve, reject) {
      var downloadId = null;
      var stallTimer = null;
      var settled = false;

      function finish(fn, value) {
        if (settled) return;
        settled = true;
        if (stallTimer) clearTimeout(stallTimer);
        fn(value);
      }

      function armStallTimer() {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(function () {
          try {
            if (downloadId !== null) tizen.download.cancel(downloadId);
          } catch (error) {
            // o download pode já ter terminado
          }
          finish(reject, new Error('Download parado.'));
        }, STALL_MS);
      }

      try {
        var request = new tizen.DownloadRequest(url, rootName, fileName);
        armStallTimer();
        downloadId = tizen.download.start(request, {
          onprogress: function (id, received, total) {
            armStallTimer();
            if (onProgress) onProgress(received, total);
          },
          onpaused: function () {},
          oncanceled: function () { finish(reject, new Error('Download cancelado.')); },
          oncompleted: function (id, fullPath) { finish(resolve, fullPath); },
          onfailed: function (id, error) { finish(reject, error || new Error('Download falhou.')); },
        });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function locateDownloaded(fullPath, fileName) {
    return resolvePath(fullPath, 'r').catch(function () {
      return findOurFiles().then(function (files) {
        if (!files[fileName]) throw new Error('Arquivo baixado não encontrado.');
        return files[fileName];
      });
    });
  }

  function downloadOnce(url, fileName, onProgress) {
    return findOurFiles()
      .then(function (files) {
        // sobra de um download interrompido com o mesmo nome
        return files[fileName] ? deleteFromDir(rootDir, files[fileName]) : null;
      })
      .then(function () { return startDownload(url, fileName, onProgress); })
      .then(function (fullPath) { return locateDownloaded(fullPath, fileName); })
      .then(function (file) {
        if (!(file.fileSize > 0)) throw new Error('Arquivo vazio.');
        manifest[fileName] = { file: file.name, uri: file.toURI(), size: file.fileSize };
        saveManifest();
        try {
          localStorage.setItem(PROVEN_KEY, rootName);
        } catch (error) {
          // sem efeito na reprodução
        }
        return manifest[fileName];
      });
  }

  function download(url, fileName, onProgress) {
    if (!available) return Promise.reject(new Error('Disco indisponível.'));
    return downloadOnce(url, fileName, onProgress).catch(function (error) {
      var proven = null;
      try {
        proven = localStorage.getItem(PROVEN_KEY);
      } catch (storageError) {
        proven = null;
      }
      // Pasta que nunca completou um download: tenta a outra antes de desistir desta mídia.
      var fallback = ROOTS.filter(function (name) { return name !== rootName; })[0];
      if (proven === rootName || !fallback) throw error;
      return openRoot(fallback).then(function () { return downloadOnce(url, fileName, onProgress); });
    });
  }

  function remove(fileName) {
    if (!available || !manifest[fileName]) return Promise.resolve();
    var actual = manifest[fileName].file;
    delete manifest[fileName];
    saveManifest();
    return findOurFiles()
      .then(function (files) { return files[actual] ? deleteFromDir(rootDir, files[actual]) : null; })
      .catch(function () {});
  }

  function clear() {
    manifest = {};
    saveManifest();
    if (!available) return Promise.resolve();
    return reconcile().catch(function () {});
  }

  root.CoalaSignageMedia = {
    isAvailable: function () { return available; },
    getManifest: function () { return manifest; },
    init: init,
    download: download,
    remove: remove,
    clear: clear,
  };
})(typeof self !== 'undefined' ? self : this);
