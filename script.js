// ===== Elements =====
const $ = (id) => document.getElementById(id);
const audio = $("audio");
const songList = $("songList");
const queueList = $("queueList");
const searchInput = $("search");
const seek = $("seek");
const volume = $("volume");
const playBtn = $("playBtn");
const playIcon = $("playIcon");

const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
const ICON_PAUSE = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
const ICON_ADD = '<svg viewBox="0 0 24 24"><path d="M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v-3h-2v3h-3v2h3v3h2v-3h3v-2z"/></svg>';
const ICON_PLAYLIST = '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
const ICON_REMOVE = '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

// ===== State =====
let library = [];      // [{ title, artist, src }]
let current = -1;      // index into library
let queue = [];        // library indices waiting to play next
let history = [];      // previously played indices (for "previous")
let shuffle = false;
let repeat = true;
let objectUrls = [];   // URLs created when loading a local folder
const PLAYLIST_STORE = "soloplayer.playlists"; // localStorage key
let keyIndex = new Map(); // song key -> library index
let playlists = loadPlaylists(); // [{ id, name, songs: [songKey] }]
let contextId = null;  // id of the playlist we're playing through (null = whole library)
let openPlaylistId = null; // playlist shown in the sidebar

// ===== Helpers =====
function parseName(path) {
  const file = decodeURIComponent(path.split("/").pop()).replace(/\.[^.]+$/, "");
  const parts = file.split(" - ");
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { artist: "Unknown artist", title: file.replace(/_/g, " ").trim() };
}

function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function artStyle(song) {
  const h = hue(song.title + song.artist);
  return `background: linear-gradient(135deg, hsl(${h} 65% 45%), hsl(${(h + 50) % 360} 60% 25%));`;
}

function initials(song) {
  return song.title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "♪";
}

function fmt(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setFill(range) {
  const pct = ((range.value - range.min) / (range.max - range.min)) * 100 || 0;
  range.style.setProperty("--fill", pct + "%");
}

// Songs are identified by file name so playlists survive reloads
// (and also match when the same files are loaded with "Open folder").
function songKey(path) {
  return decodeURIComponent(path.split("/").pop());
}

// ===== Loading songs =====
function loadLibrary(entries) {
  library = entries
    .map(({ src, name }) => ({ ...parseName(name || src), src, key: songKey(name || src) }))
    .sort((a, b) => a.title.localeCompare(b.title));
  keyIndex = new Map(library.map((song, i) => [song.key, i]));
  current = -1;
  contextId = null;
  queue = [];
  history = [];
  audio.pause();
  audio.removeAttribute("src");
  updateNowPlaying();
  renderLibrary();
  renderQueue();
  renderPlaylists();
}

// From songs.js
loadLibrary((window.SONGS || []).map((src) => ({ src })));

// From the "Open folder" button
$("folderInput").addEventListener("change", (e) => {
  const files = [...e.target.files].filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|ogg|wav|flac|aac)$/i.test(f.name));
  if (!files.length) return;
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = files.map((f) => URL.createObjectURL(f));
  loadLibrary(files.map((f, i) => ({ src: objectUrls[i], name: f.name })));
  e.target.value = "";
});

// ===== Rendering =====
function renderLibrary() {
  const q = searchInput.value.trim().toLowerCase();
  const matches = library
    .map((song, i) => ({ song, i }))
    .filter(({ song }) => !q || song.title.toLowerCase().includes(q) || song.artist.toLowerCase().includes(q));

  $("libraryCount").textContent = q
    ? `${matches.length} of ${library.length} songs`
    : `${library.length} song${library.length === 1 ? "" : "s"}`;

  if (!library.length) {
    songList.innerHTML = `<li class="empty">No songs yet. Put mp3s in the <code>music</code> folder and list them in <code>songs.js</code> (or run <code>generate_songs.py</code>), or click <b>Open folder</b>.</li>`;
    return;
  }
  if (!matches.length) {
    songList.innerHTML = `<li class="empty">No songs match “${escapeHtml(searchInput.value)}”.</li>`;
    return;
  }

  songList.innerHTML = matches
    .map(({ song, i }) => `
      <li class="song ${i === current ? "active" : ""}" data-index="${i}">
        <div class="thumb" style="${artStyle(song)}">${escapeHtml(initials(song))}</div>
        <div class="song-text">
          <div class="song-title">${escapeHtml(song.title)}</div>
          <div class="song-artist">${escapeHtml(song.artist)}</div>
        </div>
        <button class="icon-btn" data-action="playlist" title="Add to playlist">${ICON_PLAYLIST}</button>
        <button class="icon-btn" data-action="queue" title="Add to queue">${ICON_ADD}</button>
      </li>`)
    .join("");
}

function renderQueue() {
  $("queueCount").textContent = queue.length ? `· ${queue.length}` : "";
  if (!queue.length) {
    queueList.innerHTML = `<li class="empty">Your queue is empty. Hover a song in the library and click the + icon to add it.</li>`;
    return;
  }
  queueList.innerHTML = queue
    .map((libIndex, qi) => {
      const song = library[libIndex];
      return `
        <li class="queue-item" data-qi="${qi}">
          <span class="queue-pos">${qi + 1}</span>
          <div class="thumb" style="${artStyle(song)}">${escapeHtml(initials(song))}</div>
          <div class="song-text">
            <div class="song-title">${escapeHtml(song.title)}</div>
            <div class="song-artist">${escapeHtml(song.artist)}</div>
          </div>
          <button class="icon-btn" data-action="remove" title="Remove from queue">${ICON_REMOVE}</button>
        </li>`;
    })
    .join("");
}

function updateNowPlaying() {
  const song = library[current];
  const cover = $("cover");
  if (!song) {
    $("trackTitle").textContent = "Nothing playing";
    $("trackArtist").textContent = library.length ? "Pick a song from the library" : "Add some songs to get started";
    cover.setAttribute("style", "");
    $("coverText").textContent = "♪";
    document.title = "Music Player";
    return;
  }
  $("trackTitle").textContent = song.title;
  $("trackArtist").textContent = song.artist;
  cover.setAttribute("style", artStyle(song));
  $("coverText").textContent = initials(song);
  document.querySelector(".main").style.setProperty("--glow", `hsl(${hue(song.title + song.artist)} 45% 16%)`);
  document.title = `${song.title} · ${song.artist}`;
}

function updatePlayButton() {
  const playing = !audio.paused;
  playIcon.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  $("cover").classList.toggle("playing", playing);
}

// ===== Playback =====
function playIndex(i, { addToHistory = true } = {}) {
  if (i < 0 || i >= library.length) return;
  if (addToHistory && current !== -1 && current !== i) history.push(current);
  current = i;
  audio.src = library[i].src;
  audio.play().catch(() => {});
  updateNowPlaying();
  renderLibrary();
  renderPlaylists();
}

// The list of library indices that next/previous step through
function playOrder() {
  const pl = playlists.find((p) => p.id === contextId);
  if (pl) {
    const order = playlistIndices(pl);
    if (order.length) return order;
  }
  return library.map((_, i) => i);
}

function togglePlay() {
  if (!library.length) return;
  if (current === -1) return next();
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}

function next() {
  if (!library.length) return;
  if (queue.length) {
    playIndex(queue.shift());
    renderQueue();
    return;
  }
  const order = playOrder();
  if (shuffle && order.length > 1) {
    let r;
    do { r = order[Math.floor(Math.random() * order.length)]; } while (r === current);
    return playIndex(r);
  }
  const n = order.indexOf(current) + 1;
  if (n < order.length) return playIndex(order[n]);
  if (repeat) return playIndex(order[0]);
  audio.pause();
  audio.currentTime = 0;
}

function prev() {
  if (!library.length) return;
  // Restart the song if we're more than 3 seconds in
  const order = playOrder();
  if (audio.currentTime > 3 || (current !== -1 && !history.length && current === order[0])) {
    audio.currentTime = 0;
    return;
  }
  if (history.length) return playIndex(history.pop(), { addToHistory: false });
  playIndex(order[Math.max(0, order.indexOf(current) - 1)], { addToHistory: false });
}

function addToQueue(i) {
  queue.push(i);
  renderQueue();
  // If nothing has played yet, start right away
  if (current === -1) next();
}

// ===== Events =====
playBtn.addEventListener("click", togglePlay);
$("nextBtn").addEventListener("click", next);
$("prevBtn").addEventListener("click", prev);

$("shuffleBtn").addEventListener("click", (e) => {
  shuffle = !shuffle;
  e.currentTarget.classList.toggle("on", shuffle);
});
$("repeatBtn").classList.toggle("on", repeat);
$("repeatBtn").addEventListener("click", (e) => {
  repeat = !repeat;
  e.currentTarget.classList.toggle("on", repeat);
});

$("clearQueue").addEventListener("click", () => { queue = []; renderQueue(); });

songList.addEventListener("click", (e) => {
  const li = e.target.closest(".song");
  if (!li) return;
  const i = Number(li.dataset.index);
  if (e.target.closest('[data-action="queue"]')) addToQueue(i);
  else if (e.target.closest('[data-action="playlist"]')) openPlaylistMenu(i, e.target.closest("button"));
  else { contextId = null; playIndex(i); }
});

queueList.addEventListener("click", (e) => {
  const li = e.target.closest(".queue-item");
  if (!li) return;
  const qi = Number(li.dataset.qi);
  if (e.target.closest('[data-action="remove"]')) {
    queue.splice(qi, 1);
  } else {
    // Click a queued song to jump straight to it
    const [i] = queue.splice(qi, 1);
    playIndex(i);
  }
  renderQueue();
});

searchInput.addEventListener("input", renderLibrary);

audio.addEventListener("play", updatePlayButton);
audio.addEventListener("pause", updatePlayButton);
audio.addEventListener("ended", next);
audio.addEventListener("loadedmetadata", () => {
  $("duration").textContent = fmt(audio.duration);
});
audio.addEventListener("timeupdate", () => {
  if (!audio.duration) return;
  seek.value = (audio.currentTime / audio.duration) * 100;
  setFill(seek);
  $("currentTime").textContent = fmt(audio.currentTime);
});
audio.addEventListener("error", () => {
  if (current !== -1) $("trackArtist").textContent = "Couldn't load this file — check the path in songs.js";
});

seek.addEventListener("input", () => {
  if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration;
  setFill(seek);
});

audio.volume = volume.value;
setFill(volume);
volume.addEventListener("input", () => {
  audio.volume = volume.value;
  setFill(volume);
});

// Keyboard shortcuts (ignored while typing in the search box)
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowRight" && e.shiftKey) next();
  else if (e.key === "ArrowLeft" && e.shiftKey) prev();
  else if (e.key === "/") { e.preventDefault(); searchInput.focus(); }
});

// ===== Playlists =====
function loadPlaylists() {
  try {
    const data = JSON.parse(localStorage.getItem(PLAYLIST_STORE));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function savePlaylists() {
  try { localStorage.setItem(PLAYLIST_STORE, JSON.stringify(playlists)); } catch {}
}

function getPlaylist(id) {
  return playlists.find((p) => p.id === id);
}

// Library indices for a playlist's songs (skips songs not in the current library)
function playlistIndices(pl) {
  return pl.songs.map((k) => keyIndex.get(k)).filter((i) => i !== undefined);
}

function createPlaylist(name) {
  name = name.trim();
  if (!name) return null;
  const pl = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, songs: [] };
  playlists.push(pl);
  savePlaylists();
  renderPlaylists();
  return pl;
}

function toggleInPlaylist(pl, libIndex) {
  const key = library[libIndex].key;
  const at = pl.songs.indexOf(key);
  if (at === -1) pl.songs.push(key);
  else pl.songs.splice(at, 1);
  savePlaylists();
  renderPlaylists();
}

function playPlaylist(pl, { shuffled = false, startAt } = {}) {
  const order = playlistIndices(pl);
  if (!order.length) return;
  contextId = pl.id;
  queue = [];
  renderQueue();
  let first = startAt ?? order[0];
  if (shuffled) {
    shuffle = true;
    $("shuffleBtn").classList.add("on");
    first = order[Math.floor(Math.random() * order.length)];
  }
  playIndex(first);
}

function showView(view) {
  $("songsView").hidden = view !== "songs";
  $("playlistsView").hidden = view !== "playlists";
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.view === view));
  closePlaylistMenu();
}

function openPlaylist(id) {
  openPlaylistId = id;
  showView("playlists");
  renderPlaylists();
}

function songRow(song, i, extraClass, buttons) {
  return `
    <li class="song ${extraClass} ${i === current ? "active" : ""}" data-index="${i}">
      <div class="thumb" style="${artStyle(song)}">${escapeHtml(initials(song))}</div>
      <div class="song-text">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
      </div>
      ${buttons}
    </li>`;
}

function renderPlaylists() {
  const pl = getPlaylist(openPlaylistId);
  $("playlistIndex").hidden = !!pl;
  $("playlistDetail").hidden = !pl;

  if (!pl) {
    openPlaylistId = null;
    const list = $("playlistList");
    if (!playlists.length) {
      list.innerHTML = `<li class="empty">No playlists yet. Name one above, then use the <b>+</b> button on any song to add it.</li>`;
      return;
    }
    list.innerHTML = playlists
      .map((p) => {
        const count = playlistIndices(p).length;
        const first = library[playlistIndices(p)[0]];
        const art = first ? artStyle(first) : "";
        return `
          <li class="song playlist-row ${p.id === contextId ? "active" : ""}" data-id="${p.id}">
            <div class="thumb" style="${art}">${escapeHtml(p.name[0].toUpperCase())}</div>
            <div class="song-text">
              <div class="song-title">${escapeHtml(p.name)}</div>
              <div class="song-artist">${count} song${count === 1 ? "" : "s"}</div>
            </div>
          </li>`;
      })
      .join("");
    return;
  }

  const indices = playlistIndices(pl);
  const missing = pl.songs.length - indices.length;
  $("plName").textContent = pl.name;
  $("plCount").textContent =
    `${indices.length} song${indices.length === 1 ? "" : "s"}` + (missing ? ` · ${missing} not in library` : "");
  $("plPlay").disabled = $("plShuffle").disabled = !indices.length;

  $("plSongs").innerHTML = indices.length
    ? indices
        .map((i) => songRow(library[i], i, "", `<button class="icon-btn" data-action="remove" title="Remove from playlist">${ICON_REMOVE}</button>`))
        .join("")
    : `<li class="empty">This playlist is empty. Go to <b>Songs</b> and click the <b>+</b> button on a song to add it here.</li>`;
}

// --- Tabs & playlist list ---
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    if (t.dataset.view === "playlists") openPlaylistId = null;
    showView(t.dataset.view);
    renderPlaylists();
  })
);

$("newPlaylistForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const pl = createPlaylist($("newPlaylistName").value);
  $("newPlaylistName").value = "";
  if (pl) openPlaylist(pl.id);
});

$("playlistList").addEventListener("click", (e) => {
  const li = e.target.closest(".playlist-row");
  if (li) openPlaylist(li.dataset.id);
});

// --- Single playlist ---
$("plBack").addEventListener("click", () => { openPlaylistId = null; renderPlaylists(); });
$("plPlay").addEventListener("click", () => playPlaylist(getPlaylist(openPlaylistId)));
$("plShuffle").addEventListener("click", () => playPlaylist(getPlaylist(openPlaylistId), { shuffled: true }));

$("plRename").addEventListener("click", () => {
  const pl = getPlaylist(openPlaylistId);
  const name = prompt("Rename playlist", pl.name);
  if (name && name.trim()) {
    pl.name = name.trim();
    savePlaylists();
    renderPlaylists();
  }
});

$("plDelete").addEventListener("click", () => {
  const pl = getPlaylist(openPlaylistId);
  if (!confirm(`Delete the playlist "${pl.name}"? Songs stay in your library.`)) return;
  playlists = playlists.filter((p) => p !== pl);
  if (contextId === pl.id) contextId = null;
  openPlaylistId = null;
  savePlaylists();
  renderPlaylists();
});

$("plSongs").addEventListener("click", (e) => {
  const li = e.target.closest(".song");
  if (!li) return;
  const pl = getPlaylist(openPlaylistId);
  const i = Number(li.dataset.index);
  if (e.target.closest('[data-action="remove"]')) toggleInPlaylist(pl, i);
  else playPlaylist(pl, { startAt: i });
});

// --- "Add to playlist" menu ---
const plMenu = $("plMenu");
let menuSong = -1;

function renderPlaylistMenu() {
  const key = library[menuSong]?.key;
  $("plMenuList").innerHTML = playlists.length
    ? playlists
        .map((p) => {
          const has = p.songs.includes(key);
          return `<li><button data-id="${p.id}" class="${has ? "has" : ""}">
            <span>${escapeHtml(p.name)}</span>${has ? ICON_CHECK : ""}</button></li>`;
        })
        .join("")
    : `<li class="menu-empty">No playlists yet</li>`;
}

function openPlaylistMenu(libIndex, anchor) {
  menuSong = libIndex;
  renderPlaylistMenu();
  plMenu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = plMenu.offsetWidth, h = plMenu.offsetHeight;
  plMenu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  plMenu.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4) + "px";
}

function closePlaylistMenu() {
  plMenu.hidden = true;
  menuSong = -1;
}

$("plMenuList").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  toggleInPlaylist(getPlaylist(btn.dataset.id), menuSong);
  renderPlaylistMenu();
});

$("plMenuForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const pl = createPlaylist($("plMenuName").value);
  $("plMenuName").value = "";
  if (!pl) return;
  toggleInPlaylist(pl, menuSong);
  renderPlaylistMenu();
});

document.addEventListener("click", (e) => {
  if (plMenu.hidden) return;
  if (!plMenu.contains(e.target) && !e.target.closest('[data-action="playlist"]')) closePlaylistMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePlaylistMenu(); });
$("songList").addEventListener("scroll", closePlaylistMenu);

renderPlaylists();
