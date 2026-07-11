/**
 * Orgel – Historic Organ Audio Engine
 *
 * Mobile / iOS fix:
 *   AudioContext is created and resumed SYNCHRONOUSLY inside the Play click
 *   handler so iOS Safari's autoplay policy is satisfied.
 *   Audio files are pre-fetched as ArrayBuffers (no AudioContext needed).
 *   Decoding happens on first Play press and results are cached.
 *
 * All 17 samples start at the exact same scheduled AudioContext timestamp.
 * Each stop has its own GainNode (1 = audible, 0 = muted).
 * Toggling a stop cross-fades its gain – no source restart.
 * Pause fades master gain to zero first to prevent the click artifact.
 */

(function () {
    'use strict';

    var AUDIO_BASE    = 'assets/audio/ORGEL/';
    var START_AHEAD_S = 0.06;
    var KNOB_FRAME_H  = 55;
    var FRAME_ON      = 5;
    var FRAME_OFF     = 0;
    var GAIN_FADE_S   = 0.04;
    var DECLICK_S     = 0.07;

    // ── Audio state ────────────────────────────────────────────────────────
    var audioCtx   = null;
    var masterGain = null;
    var stopGains  = {};
    var sources    = {};
    var rawBuffers = {};   // file → ArrayBuffer  (pre-fetched, no ctx needed)
    var buffers    = {};   // file → AudioBuffer  (decoded, cached)
    var isPlaying  = false;

    // ── File list (populated once DOM is ready) ────────────────────────────
    var allFiles    = [];
    var loadedCount = 0;

    function getVolume() {
        var s = document.getElementById('organ-volume');
        return s ? parseInt(s.value, 10) / 100 : 0.8;
    }

    // ── Phase 1: pre-fetch as ArrayBuffers ────────────────────────────────
    // No AudioContext involved – works before any user gesture.
    function loadAll() {
        allFiles.forEach(function (file) {
            fetch(AUDIO_BASE + file + '.mp3')
                .then(function (res) {
                    if (!res.ok) throw new Error(res.status);
                    return res.arrayBuffer();
                })
                .then(function (ab) {
                    rawBuffers[file] = ab;
                    tickLoad();
                })
                .catch(function (err) {
                    console.warn('[Orgel] fetch failed:', file, err);
                    tickLoad();
                });
        });
    }

    function tickLoad() {
        loadedCount++;
        var pct = loadedCount / allFiles.length * 100;
        var fill = document.getElementById('organ-loading-fill');
        if (fill) fill.style.width = pct + '%';
        if (loadedCount >= allFiles.length) onAllLoaded();
    }

    function onAllLoaded() {
        var btn = document.getElementById('organ-play-btn');
        var lbl = document.getElementById('organ-play-label');
        if (btn) btn.disabled = false;
        if (lbl) lbl.textContent = 'Play';
        var fill = document.getElementById('organ-loading-fill');
        if (fill) setTimeout(function () { fill.style.opacity = '0'; }, 400);
        updateStatus();
    }

    // ── Phase 2: decode (called on first Play, inside user gesture) ────────
    // Uses callback form for maximum iOS compatibility.
    function decodeAll(ctx, done) {
        var pending = 0;
        allFiles.forEach(function (file) {
            if (buffers[file] || !rawBuffers[file]) return;
            pending++;
            // slice() so the ArrayBuffer is not detached
            ctx.decodeAudioData(
                rawBuffers[file].slice(0),
                function (decoded) {
                    buffers[file] = decoded;
                    if (--pending === 0) done();
                },
                function (err) {
                    console.warn('[Orgel] decode error:', file, err);
                    if (--pending === 0) done();
                }
            );
        });
        if (pending === 0) done();
    }

    // ── Responsive canvas scaler ───────────────────────────────────────────
    function scaleCanvas() {
        var scaler = document.getElementById('organ-canvas-scaler');
        var canvas = document.getElementById('organ-canvas');
        if (!scaler || !canvas) return;
        var avail  = scaler.getBoundingClientRect().width || 800;
        var scale  = avail / 1000;
        canvas.style.transform = 'scale(' + scale + ')';
        scaler.style.height    = Math.round(566 * scale) + 'px';
    }

    // ── Sprite helper ──────────────────────────────────────────────────────
    function setFrame(btn, frame) {
        btn.style.backgroundPositionY = -(frame * KNOB_FRAME_H) + 'px';
    }

    // ── Toggle a stop ──────────────────────────────────────────────────────
    function toggleStop(btn) {
        var isNowActive = btn.classList.toggle('active');
        btn.setAttribute('aria-pressed', String(isNowActive));
        setFrame(btn, isNowActive ? FRAME_ON : FRAME_OFF);

        if (isPlaying && audioCtx && stopGains[btn.dataset.file]) {
            var target = isNowActive ? 1 : 0;
            stopGains[btn.dataset.file].gain
                .setTargetAtTime(target, audioCtx.currentTime, GAIN_FADE_S);
        }
        updateStatus();
    }

    // ── Source management ──────────────────────────────────────────────────
    function stopAllSources() {
        Object.keys(sources).forEach(function (f) {
            try { sources[f].stop(); }    catch (e) {}
            try { sources[f].disconnect(); } catch (e) {}
        });
        Object.keys(stopGains).forEach(function (f) {
            try { stopGains[f].disconnect(); } catch (e) {}
        });
        sources   = {};
        stopGains = {};
    }

    function scheduleAllSources() {
        var startTime = audioCtx.currentTime + START_AHEAD_S;
        allFiles.forEach(function (file) {
            if (!buffers[file]) return;
            var isActive = !!document.querySelector('[data-file="' + file + '"].active');
            var gain = audioCtx.createGain();
            gain.gain.value = isActive ? 1 : 0;
            gain.connect(masterGain);
            stopGains[file] = gain;

            var src = audioCtx.createBufferSource();
            src.buffer = buffers[file];
            src.loop   = true;
            src.connect(gain);
            src.start(startTime);
            sources[file] = src;
        });
    }

    // ── Play ───────────────────────────────────────────────────────────────
    // AudioContext is created + resumed SYNCHRONOUSLY here (iOS requirement).
    function startPlayback() {
        // 1. Create AudioContext synchronously inside the click event
        if (!audioCtx) {
            audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = getVolume();
            masterGain.connect(audioCtx.destination);
        }
        // 2. Resume synchronously (iOS needs this in the same call stack)
        audioCtx.resume();

        // Auto-activate Principal 8' when nothing is selected
        if (!document.querySelector('.organ-stop-btn.active')) {
            var p = document.querySelector('[data-file="PRINCIPAL8"]');
            if (p) toggleStop(p);
        }

        // 3. Update UI immediately
        isPlaying = true;
        updatePlayBtn();

        var lbl = document.getElementById('organ-play-label');
        var allDecoded = allFiles.every(function (f) { return !!buffers[f]; });

        if (allDecoded) {
            stopAllSources();
            scheduleAllSources();
            updateStatus();
        } else {
            // Show brief "decoding" state, then start
            if (lbl) lbl.textContent = '...';
            decodeAll(audioCtx, function () {
                stopAllSources();
                scheduleAllSources();
                updatePlayBtn();
                updateStatus();
            });
        }
    }

    // ── Pause ──────────────────────────────────────────────────────────────
    function stopPlayback() {
        if (!audioCtx || !masterGain) {
            isPlaying = false;
            updatePlayBtn();
            updateStatus();
            return;
        }

        // Fade out to avoid click
        var now  = audioCtx.currentTime;
        var vol  = getVolume();
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value || 0.001, now);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, now + DECLICK_S);

        isPlaying = false;
        updatePlayBtn();
        updateStatus();

        setTimeout(function () {
            stopAllSources();
            if (audioCtx && masterGain) {
                masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
                masterGain.gain.setValueAtTime(vol, audioCtx.currentTime);
            }
        }, Math.ceil(DECLICK_S * 1000) + 30);
    }

    // ── Play button UI ─────────────────────────────────────────────────────
    function updatePlayBtn() {
        var btn = document.getElementById('organ-play-btn');
        var lbl = document.getElementById('organ-play-label');
        if (!btn) return;
        if (isPlaying) {
            btn.classList.add('is-playing');
            if (lbl) lbl.textContent = 'Pause';
        } else {
            btn.classList.remove('is-playing');
            if (lbl) lbl.textContent = 'Play';
        }
    }

    // ── Status ─────────────────────────────────────────────────────────────
    function updateStatus() {
        var active  = document.querySelectorAll('.organ-stop-btn.active').length;
        var text    = document.getElementById('organ-status-text');
        var counter = document.getElementById('organ-active-count');
        if (counter) counter.textContent = active + ' registers active';
        if (text) {
            text.textContent = isPlaying && active > 0
                ? active + ' stop' + (active !== 1 ? 's' : '') + ' active'
                : active + ' stop' + (active !== 1 ? 's' : '') + ' ready';
        }
    }

    // ── Volume ─────────────────────────────────────────────────────────────
    function setupVolume() {
        var slider = document.getElementById('organ-volume');
        var lbl    = document.getElementById('organ-vol-label');
        if (!slider) return;
        slider.addEventListener('input', function () {
            if (lbl) lbl.textContent = this.value;
            if (masterGain && audioCtx) {
                masterGain.gain.setTargetAtTime(
                    parseInt(this.value, 10) / 100,
                    audioCtx.currentTime,
                    0.05
                );
            }
        });
    }

    // ── Init ───────────────────────────────────────────────────────────────
    function init() {
        // Collect all file names from DOM
        document.querySelectorAll('.organ-stop-btn').forEach(function (btn) {
            var f = btn.dataset.file;
            if (f && allFiles.indexOf(f) === -1) allFiles.push(f);
        });

        scaleCanvas();
        requestAnimationFrame(scaleCanvas);
        window.addEventListener('resize', scaleCanvas);

        // Wire stop knobs
        document.querySelectorAll('.organ-stop-btn').forEach(function (btn) {
            setFrame(btn, FRAME_OFF);
            btn.addEventListener('click', function () { toggleStop(btn); });
            btn.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleStop(btn);
                }
            });
        });

        // Play / Pause
        var playBtn = document.getElementById('organ-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', function () {
                if (isPlaying) { stopPlayback(); } else { startPlayback(); }
            });
        }

        // Hero CTA scroll
        var tryBtn = document.getElementById('hero-try-btn');
        if (tryBtn) {
            tryBtn.addEventListener('click', function () {
                var demo = document.getElementById('demo');
                if (demo) demo.scrollIntoView({ behavior: 'smooth' });
            });
        }

        // Clear all
        var clearBtn = document.getElementById('organ-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                stopPlayback();
                document.querySelectorAll('.organ-stop-btn.active').forEach(function (btn) {
                    btn.classList.remove('active');
                    btn.setAttribute('aria-pressed', 'false');
                    setFrame(btn, FRAME_OFF);
                });
                updateStatus();
            });
        }

        setupVolume();

        document.addEventListener('visibilitychange', function () {
            if (document.hidden && isPlaying) stopPlayback();
        });
        window.addEventListener('pagehide', function () {
            if (isPlaying) stopPlayback();
        });

        // Start fetching (no AudioContext needed for this)
        loadAll();
        updateStatus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
