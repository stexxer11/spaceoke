import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Search,
  Tv,
  Mic2,
  Play,
  Pause,
  Plus,
  Crown,
  KeyRound,
  Music,
  LogOut,
  Radio,
  Clapperboard,
  SkipForward,
  DoorOpen,
  Trash2,
  Repeat,
  ArrowUp,
  Zap,
  Upload,
  Image as ImageIcon,
  Type,
  Eye,
  Palette,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import * as api from "./services/spaceokeSupabase";
import "./styles.css";

const ACTIVE_STATUSES = ["queued", "playing"];
const HISTORY_STATUSES = ["done", "cancelled", "no_show", "skipped", "video_error"];
const MAX_RETRIES = 2;
const INTRO_SECONDS = 4;

const promoFontOptions = [
  { id: "display", name: "Display fuerte" },
  { id: "elegant", name: "Elegante" },
  { id: "urban", name: "Urbana" },
  { id: "clean", name: "Limpia" },
];


const DEV_ROOMS_STORAGE_KEY = "spaceoke_dev_private_rooms_v1";

const YOUTUBE_SEARCH_CACHE_KEY = "spaceoke_youtube_search_cache_v1";
const YOUTUBE_VIDEO_CATALOG_KEY = "spaceoke_youtube_video_catalog_v1";
const YOUTUBE_BLOCKED_VIDEOS_KEY = "spaceoke_youtube_blocked_videos_v1";
const LOCAL_VIDEO_SOURCE_PREFIX = "local-video-";
const APP_SESSION_STORAGE_KEY = "spaceoke_last_session_v1";
const ROOM_PROFILE_STORAGE_PREFIX = "spaceoke_room_profile_v2_";
const ADMIN_ACCESS_STORAGE_PREFIX = "spaceoke_admin_access_v1_";
const ROOM_STATE_STORAGE_PREFIX = "spaceoke_room_state_v1_";
const ROOM_USERS_STORAGE_PREFIX = "spaceoke_room_users_v1_";
const SEARCH_COOLDOWN_MS = 9000;
const SEARCH_CACHE_HOURS = 24 * 7;
const MAX_YOUTUBE_RESULTS = 6;
const ACTIVE_USER_TTL_MS = 45 * 1000;

const karaokePositiveWords = [
  "karaoke",
  "instrumental",
  "lyrics",
  "letra",
  "version karaoke",
  "karaoke version",
  "sin voz",
  "pista",
  "backing track",
];

const karaokeBlockedWords = [
  "official video",
  "video oficial",
  "audio oficial",
  "official audio",
  "reaction",
  "tutorial",
  "lesson",
  "cover",
  "en vivo",
  "live",
  "acoustic",
  "entrevista",
];

const trustedKaraokeChannels = [
  "karaoke version",
  "sing king",
  "karafun",
  "the karaoke channel",
  "tracks planet",
  "karaoke latino",
];

const normalizeSearchQuery = (text) => {
  const base = (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) return "";
  return base.includes("karaoke") ? base : `${base} karaoke`;
};

const youtubeUrlFromId = (youtubeId) => `https://www.youtube.com/watch?v=${youtubeId}`;

const loadJsonStorage = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (error) {
    console.warn(`No se pudo cargar ${key}`, error);
    return fallback;
  }
};

const saveJsonStorage = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const removeJsonStorage = (key) => {
  localStorage.removeItem(key);
};

const loadAppSession = () => loadJsonStorage(APP_SESSION_STORAGE_KEY, null);

const saveAppSession = (session) => {
  saveJsonStorage(APP_SESSION_STORAGE_KEY, {
    ...session,
    savedAt: nowIso(),
  });
};

const getAdminAccessKey = (ticket) => `${ADMIN_ACCESS_STORAGE_PREFIX}${makeTicket(ticket)}`;

const rememberAdminAccess = (ticket) => {
  if (!ticket) return;
  localStorage.setItem(getAdminAccessKey(ticket), "true");
};

const hasRememberedAdminAccess = (ticket) => {
  if (!ticket) return false;
  return localStorage.getItem(getAdminAccessKey(ticket)) === "true";
};

const getRoomProfileKey = (ticket) => `${ROOM_PROFILE_STORAGE_PREFIX}${makeTicket(ticket)}`;

const loadRoomProfile = (ticket) => {
  const cleanTicket = makeTicket(ticket);
  if (!cleanTicket) return null;

  const profile = loadJsonStorage(getRoomProfileKey(cleanTicket), null);
  if (!profile?.playerName || !profile?.selectedAvatar || !profile?.playerId) return null;

  return profile;
};

const saveRoomProfile = (ticket, profile) => {
  const cleanTicket = makeTicket(ticket);
  if (!cleanTicket || !profile?.playerName || !profile?.selectedAvatar || !profile?.playerId) return;

  saveJsonStorage(getRoomProfileKey(cleanTicket), {
    playerName: profile.playerName,
    selectedAvatar: profile.selectedAvatar,
    playerId: profile.playerId,
    savedAt: nowIso(),
  });
};

const clearRoomProfile = (ticket) => {
  const cleanTicket = makeTicket(ticket);
  if (!cleanTicket) return;
  removeJsonStorage(getRoomProfileKey(cleanTicket));
};

const isYoutubeIdBlocked = (youtubeId, blockedVideos = []) => {
  if (!youtubeId) return false;
  return blockedVideos.some((video) => video.youtubeId === youtubeId);
};

const filterBlockedYoutubeVideos = (videos = [], blockedVideos = []) => {
  return videos.filter((video) => !isYoutubeIdBlocked(video.youtubeId, blockedVideos));
};

const getRoomStateStorageKey = (roomCode) => `${ROOM_STATE_STORAGE_PREFIX}${makeTicket(roomCode) || roomCode}`;

const getRoomUsersStorageKey = (roomCode) => `${ROOM_USERS_STORAGE_PREFIX}${makeTicket(roomCode) || roomCode}`;

const loadRoomState = (roomCode) => {
  if (!roomCode) return null;
  return loadJsonStorage(getRoomStateStorageKey(roomCode), null);
};

const saveRoomState = (roomCode, state) => {
  if (!roomCode) return;
  saveJsonStorage(getRoomStateStorageKey(roomCode), state);
};

const getActiveUsersForRoom = (roomCode) => {
  if (!roomCode) return [];

  const users = loadJsonStorage(getRoomUsersStorageKey(roomCode), {});
  const now = Date.now();

  return Object.values(users).filter((user) => {
    if (!user?.lastSeenAt) return false;
    return now - new Date(user.lastSeenAt).getTime() < ACTIVE_USER_TTL_MS;
  });
};

const heartbeatRoomUser = (roomCode, playerId, userData) => {
  if (!roomCode || !playerId) return;

  const key = getRoomUsersStorageKey(roomCode);
  const current = loadJsonStorage(key, {});
  const now = Date.now();
  const cleaned = Object.fromEntries(
    Object.entries(current).filter(([, user]) => {
      if (!user?.lastSeenAt) return false;
      return now - new Date(user.lastSeenAt).getTime() < ACTIVE_USER_TTL_MS;
    })
  );

  cleaned[playerId] = {
    ...userData,
    playerId,
    lastSeenAt: nowIso(),
  };

  saveJsonStorage(key, cleaned);
};

const removeRoomUser = (roomCode, playerId) => {
  if (!roomCode || !playerId) return;

  const key = getRoomUsersStorageKey(roomCode);
  const current = loadJsonStorage(key, {});
  delete current[playerId];
  saveJsonStorage(key, current);
};

const isCacheFresh = (cachedAt) => {
  if (!cachedAt) return false;
  const ageMs = Date.now() - new Date(cachedAt).getTime();
  return ageMs < SEARCH_CACHE_HOURS * 60 * 60 * 1000;
};

const looksLikeKaraoke = (video) => {
  const haystack = `${video.title || ""} ${video.channelTitle || ""}`.toLowerCase();
  const blocked = karaokeBlockedWords.some((word) => haystack.includes(word));
  if (blocked) return false;
  return karaokePositiveWords.some((word) => haystack.includes(word));
};

const scoreKaraokeVideo = (video) => {
  const haystack = `${video.title || ""} ${video.channelTitle || ""}`.toLowerCase();
  let score = 0;

  karaokePositiveWords.forEach((word) => {
    if (haystack.includes(word)) score += 2;
  });

  trustedKaraokeChannels.forEach((channel) => {
    if (haystack.includes(channel)) score += 4;
  });

  karaokeBlockedWords.forEach((word) => {
    if (haystack.includes(word)) score -= 5;
  });

  return score;
};

const normalizeYoutubeItem = (item, query = "") => {
  const videoId = item.id?.videoId || item.youtubeId || item.videoId || item.id;
  const snippet = item.snippet || {};

  return {
    youtubeId: videoId,
    title: snippet.title || item.title || "Karaoke sin título",
    channelTitle: snippet.channelTitle || item.channelTitle || "YouTube",
    thumbnail:
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      item.thumbnail ||
      "",
    url: youtubeUrlFromId(videoId),
    searchQuery: query,
    normalizedQuery: normalizeSearchQuery(query),
    isKaraoke: true,
    blocked: false,
    source: item.source || "youtube-api",
    playCount: item.playCount || 0,
    requestedCount: item.requestedCount || 0,
    lastUsedAt: item.lastUsedAt || null,
    createdAt: item.createdAt || nowIso(),
  };
};

const createLocalCatalogVideo = ({ title, channelTitle, localVideoUrl, thumbnail = "", searchQuery = "", originalYoutubeId = "" }) => {
  const createdAt = nowIso();
  const cleanTitle = title?.trim() || "Karaoke local";
  const cleanArtist = channelTitle?.trim() || "Biblioteca local";

  return {
    youtubeId: `${LOCAL_VIDEO_SOURCE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`,
    originalYoutubeId: originalYoutubeId?.trim() || "",
    title: cleanTitle,
    channelTitle: cleanArtist,
    thumbnail: thumbnail || "",
    url: localVideoUrl,
    localVideoUrl,
    searchQuery: searchQuery || cleanTitle,
    normalizedQuery: normalizeSearchQuery(`${searchQuery || cleanTitle} ${cleanArtist}`),
    isKaraoke: true,
    blocked: false,
    source: "local",
    playCount: 0,
    requestedCount: 0,
    lastUsedAt: null,
    createdAt,
  };
};

const demoYoutubeResults = (query) => {
  const clean = query.replace(/karaoke/g, "").trim() || "Canción";
  return [
    {
      youtubeId: "JGwWNGJdvx8",
      title: `${clean} - Karaoke Version`,
      channelTitle: "Karaoke Version Demo",
      thumbnail: "",
      url: youtubeUrlFromId("JGwWNGJdvx8"),
      searchQuery: query,
      normalizedQuery: normalizeSearchQuery(query),
      isKaraoke: true,
      blocked: false,
      source: "demo-cache",
      playCount: 0,
      requestedCount: 0,
      createdAt: nowIso(),
    },
    {
      youtubeId: "kJQP7kiw5Fk",
      title: `${clean} Karaoke Latino`,
      channelTitle: "SPACEOKE Demo",
      thumbnail: "",
      url: youtubeUrlFromId("kJQP7kiw5Fk"),
      searchQuery: query,
      normalizedQuery: normalizeSearchQuery(query),
      isKaraoke: true,
      blocked: false,
      source: "demo-cache",
      playCount: 0,
      requestedCount: 0,
      createdAt: nowIso(),
    },
  ];
};

const themePresets = [
  {
    id: "mk",
    name: "MK original",
    primary: "#8b5cf6",
    secondary: "#ec4899",
    background: "#070713",
  },
  {
    id: "gold",
    name: "Dorado premium",
    primary: "#f5c542",
    secondary: "#f97316",
    background: "#050505",
  },
  {
    id: "night",
    name: "Negro elegante",
    primary: "#ffffff",
    secondary: "#8b5cf6",
    background: "#030308",
  },
  {
    id: "blue",
    name: "Azul neon",
    primary: "#38bdf8",
    secondary: "#6366f1",
    background: "#020617",
  },
  {
    id: "green",
    name: "Verde fiesta",
    primary: "#22c55e",
    secondary: "#14b8a6",
    background: "#03120a",
  },
];

const createEmptyPromoSlides = () => [
  {
    id: "promo-1",
    enabled: false,
    title: "",
    subtitle: "",
    description: "",
    instagram: "",
    font: "display",
    duration: 7,
    image: "",
    imageName: "",
  },
  {
    id: "promo-2",
    enabled: false,
    title: "",
    subtitle: "",
    description: "",
    instagram: "",
    font: "clean",
    duration: 7,
    image: "",
    imageName: "",
  },
  {
    id: "promo-3",
    enabled: false,
    title: "",
    subtitle: "",
    description: "",
    instagram: "",
    font: "urban",
    duration: 7,
    image: "",
    imageName: "",
  },
];

const loadDevRooms = () => {
  try {
    const saved = localStorage.getItem(DEV_ROOMS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.warn("No se pudieron cargar las salas privadas", error);
    return [];
  }
};

const makeTicket = (text) => {
  return (text || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 14);
};

const makeRoomId = (text) => {
  return (text || "local")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `local-${Date.now()}`;
};

const getDateAfterDays = (days = 30) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const isRoomExpired = (room) => {
  if (!room?.expiresAt) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expires = new Date(`${room.expiresAt}T23:59:59`);
  return expires < today;
};

const getDaysToExpire = (room) => {
  if (!room?.expiresAt) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expires = new Date(`${room.expiresAt}T23:59:59`);
  return Math.ceil((expires - today) / (1000 * 60 * 60 * 24));
};

const getRoomStatus = (room) => {
  if (!room?.active) return "inactive";
  if (isRoomExpired(room)) return "expired";
  if ((getDaysToExpire(room) ?? 99) <= 7) return "warning";
  return "active";
};

const getRoomStatusLabel = (room) => {
  const status = getRoomStatus(room);

  const labels = {
    active: "Activa",
    warning: "Por vencer",
    expired: "Expirada",
    inactive: "Inactiva",
  };

  return labels[status] || "Sin estado";
};

const isRoomUsable = (room) => room?.active && !isRoomExpired(room);

const createPrivateRoomFromForm = (form) => {
  const ticket = makeTicket(form.ticket || form.businessName || `LOCAL${Date.now()}`);
  const preset = themePresets.find((theme) => theme.id === form.themePreset) || themePresets[0];

  return {
    id: `${makeRoomId(form.businessName)}-${Date.now()}`,
    ticket,
    adminPin: form.adminPin || "5050",
    active: true,
    expiresAt: form.expiresAt || getDateAfterDays(30),
    createdAt: nowIso(),
    renewedAt: nowIso(),

    businessName: form.businessName || ticket,
    publicTitle: form.publicTitle || "Karaoke Night",
    slogan: form.slogan || "Escanea, canta y disfruta la noche",
    instagram: form.instagram || "",
    location: form.location || "",
    logo: form.logo || "",

    theme: {
      preset: preset.id,
      primary: form.primary || preset.primary,
      secondary: form.secondary || preset.secondary,
      background: form.background || preset.background,
    },

    promos: createEmptyPromoSlides(),

    stats: {
      totalSongsPlayed: 0,
      totalSingers: 0,
      totalSessions: 0,
      lastActivity: null,
    },
  };
};

const avatars = [
  { id: "alien", name: "Alien", icon: "👽" },
  { id: "astro", name: "Astronauta", icon: "🚀" },
  { id: "robot", name: "Robot", icon: "🤖" },
  { id: "dj", name: "DJ", icon: "🎧" },
  { id: "rockstar", name: "Rockstar", icon: "🤘" },
  { id: "estrella", name: "Estrella", icon: "🌟" },
  { id: "ghost", name: "Fantasma", icon: "👻" },
  { id: "singer", name: "Cantante", icon: "🎤" },
  { id: "guitarra", name: "Guitarrista", icon: "🎸" },
  { id: "piano", name: "Pianista", icon: "🎹" },
  { id: "bateria", name: "Baterista", icon: "🥁" },
  { id: "violin", name: "Violinista", icon: "🎻" },
  { id: "saxo", name: "Saxofonista", icon: "🎷" },
  { id: "trompeta", name: "Trompetista", icon: "🎺" },
  { id: "fuego", name: "Fuego", icon: "🔥" },
  { id: "trofeo", name: "Prodigio", icon: "🏆" },
];

const nowIso = () => new Date().toISOString();

const normalizeSongKey = (text) => {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const formatTime = (iso) => {
  if (!iso) return "—";

  return new Date(iso).toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getStatusLabel = (status) => {
  const labels = {
    queued: "En espera",
    playing: "Sonando ahora",
    done: "Cantada",
    cancelled: "Cancelada",
    no_show: "No apareció",
    skipped: "Saltada",
    video_error: "Error de video",
  };

  return labels[status] || status;
};

const createDemoSong = (song) => {
  const requestedAt = nowIso();

  return {
    ...song,
    requestedAt,
    startedAt: song.status === "playing" ? requestedAt : null,
    endedAt: null,
    retryCount: 0,
    versionKey: normalizeSongKey(song.title),
  };
};

const demoSongs = [
  createDemoSong({
    id: 1,
    ownerId: "demo-1",
    title: "Perfect - Karaoke Version",
    artist: "Ed Sheeran",
    user: "Astronauta Rolando",
    avatar: "🚀",
    duration: "4:23",
    repeatKey: 0,
    status: "playing",
  }),
  createDemoSong({
    id: 2,
    ownerId: "demo-2",
    title: "Vivir Mi Vida - Karaoke",
    artist: "Marc Anthony",
    user: "Alien Deisy",
    avatar: "👽",
    duration: "3:58",
    repeatKey: 0,
    status: "queued",
  }),
  createDemoSong({
    id: 3,
    ownerId: "demo-3",
    title: "Take On Me - Karaoke",
    artist: "A-ha",
    user: "Robot Carlos",
    avatar: "🤖",
    duration: "4:05",
    repeatKey: 0,
    status: "queued",
  }),
];

function App() {
  const [screen, setScreen] = useState("boot");
  const [roomCode, setRoomCode] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [playerName, setPlayerName] = useState("");
  const [searchText, setSearchText] = useState("");
  const [queue, setQueue] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [youtubeSearchResults, setYoutubeSearchResults] = useState([]);
  const [youtubeSearchState, setYoutubeSearchState] = useState({
    loading: false,
    message: "",
    fromCache: false,
  });
  const [youtubeCatalog, setYoutubeCatalog] = useState(() =>
    loadJsonStorage(YOUTUBE_VIDEO_CATALOG_KEY, [])
  );
  const [blockedYoutubeVideos, setBlockedYoutubeVideos] = useState(() =>
    loadJsonStorage(YOUTUBE_BLOCKED_VIDEOS_KEY, [])
  );
  const [adminTab, setAdminTab] = useState("queue");
  const [promoSlides, setPromoSlides] = useState(createEmptyPromoSlides());
  const [activePromoIndex, setActivePromoIndex] = useState(0);
  const [karaokePaused, setKaraokePaused] = useState(false);
  const [privateRooms, setPrivateRooms] = useState([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [screenLoading, setScreenLoading] = useState({
    active: false,
    title: "",
    message: "",
  });
  const [roomClosedNotice, setRoomClosedNotice] = useState(null);
  const [lastTvSongKey, setLastTvSongKey] = useState(null);
  const [currentPrivateRoom, setCurrentPrivateRoom] = useState(null);
  const [devEditingRoomId, setDevEditingRoomId] = useState(null);
  const [lobbyBackTarget, setLobbyBackTarget] = useState("home");
  const [adminPinModal, setAdminPinModal] = useState({
    open: false,
    pin: "",
    error: "",
  });
  const [adminAccessModal, setAdminAccessModal] = useState({
    open: false,
    ticket: "",
    pin: "",
    error: "",
  });
  const urlHandledRef = useRef(false);

  const [playerId, setPlayerId] = useState(() => {
    return `player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

  const [confirmModal, setConfirmModal] = useState({
    open: false,
    title: "",
    message: "",
    confirmText: "Aceptar",
    cancelText: "Cancelar",
    danger: false,
    onConfirm: null,
  });

  const [activeRoomUsers, setActiveRoomUsers] = useState([]);
  const [roomUsersClock, setRoomUsersClock] = useState(0);
  const [roomStateReady, setRoomStateReady] = useState(false);
  const sessionRestoredRef = useRef(false);
  const roomStateLoadedRef = useRef(false);
  const lastRoomStateAppliedRef = useRef(null);
  const lastRoomStateSavedRef = useRef(null);

  const loadPrivateRoomsFromSupabase = async () => {
    try {
      const rooms = await api.listPrivateRooms();
      setPrivateRooms(rooms);
      setRoomsLoaded(true);
      console.log("Salas desde Supabase:", rooms);
    } catch (error) {
      console.error("Error conectando Supabase:", error);
      setRoomsLoaded(true);
      openConfirmModal({
        title: "Error conectando Supabase",
        message: error.message || "No se pudieron cargar las salas privadas.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
    }
  };

  useEffect(() => {
    loadPrivateRoomsFromSupabase();
  }, []);

  const showScreenLoading = (title = "Preparando", message = "Un momento...") => {
    setScreenLoading({
      active: true,
      title,
      message,
    });
  };

  const hideScreenLoading = () => {
    setScreenLoading({
      active: false,
      title: "",
      message: "",
    });
  };

  const leaveClosedRoom = async (message = "La sala fue cerrada.") => {
    try {
      if (roomCode && playerId) {
        await api.removeUser(roomCode, playerId);
      }
    } catch (error) {
      console.error("Error removiendo usuario al cerrar sala:", error);
    }

    clearRoomProfile(roomCode);
    setRoomClosedNotice(message);
    clearRoomProfile(roomCode);
    setQueue([]);
    setCurrentSong(null);
    setRoomCode("");
    setSelectedAvatar(null);
    setPlayerName("");
    setSearchText("");
    setAdminTab("queue");
    setKaraokePaused(false);
    setCurrentPrivateRoom(null);
    setPromoSlides(createEmptyPromoSlides());
    resetPlayerId();
    setScreen("home");
  };

  useEffect(() => {
    if (!roomClosedNotice) return;

    const timer = setTimeout(() => {
      setRoomClosedNotice(null);
    }, 5200);

    return () => clearTimeout(timer);
  }, [roomClosedNotice]);


  useEffect(() => {
    if (screen === "admin") {
      document.body.classList.add("admin-mode");
    } else {
      document.body.classList.remove("admin-mode");
    }

    return () => {
      document.body.classList.remove("admin-mode");
    };
  }, [screen]);

  // Las salas privadas ahora viven en Supabase. Ya no se guardan en localStorage.

  useEffect(() => {
    saveJsonStorage(YOUTUBE_VIDEO_CATALOG_KEY, youtubeCatalog);
  }, [youtubeCatalog]);

  useEffect(() => {
    saveJsonStorage(YOUTUBE_BLOCKED_VIDEOS_KEY, blockedYoutubeVideos);
  }, [blockedYoutubeVideos]);

  useEffect(() => {
    if (sessionRestoredRef.current) return;

    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) return;

    const savedSession = loadAppSession();
    if (!savedSession?.screen) return;

    sessionRestoredRef.current = true;

    const restoredRoomCode = savedSession.roomCode || "";
    const restoredPrivateRoom = restoredRoomCode
      ? privateRooms.find((room) => room.ticket === makeTicket(restoredRoomCode))
      : null;

    if (restoredPrivateRoom && isRoomUsable(restoredPrivateRoom)) {
      setCurrentPrivateRoom(restoredPrivateRoom);
      setPromoSlides(restoredPrivateRoom.promos || createEmptyPromoSlides());
      setRoomCode(restoredPrivateRoom.ticket);
    } else if (restoredRoomCode) {
      setCurrentPrivateRoom(null);
      setPromoSlides(createEmptyPromoSlides());
      setRoomCode(restoredRoomCode);
    }

    if (savedSession.selectedAvatar) {
      setSelectedAvatar(savedSession.selectedAvatar);
    }

    if (savedSession.playerName) {
      setPlayerName(savedSession.playerName);
    }

    if (savedSession.playerId) {
      setPlayerId(savedSession.playerId);
    }

    setAdminTab(savedSession.adminTab || "queue");
    setScreen(savedSession.screen);
  }, [privateRooms]);

  useEffect(() => {
    saveAppSession({
      screen,
      roomCode,
      playerName,
      selectedAvatar,
      playerId,
      adminTab,
      privateRoomTicket: currentPrivateRoom?.ticket || "",
    });
  }, [screen, roomCode, playerName, selectedAvatar, playerId, adminTab, currentPrivateRoom?.ticket]);


  const refreshRoomFromSupabase = async (reason = "sync") => {
    if (!roomCode) return;

    try {
      const [songs, session, promosFromDb] = await Promise.all([
        api.listQueue(roomCode),
        api.getRoomSession(roomCode),
        api.listPromos(roomCode).catch(() => null),
      ]);

      if (session && session.active === false && ["mobile", "admin", "tv", "lobby"].includes(screen)) {
        await leaveClosedRoom("La sala fue cerrada por el administrador.");
        return;
      }

      const cleanTicket = makeTicket(roomCode);
      let roomForTheme = currentPrivateRoom || privateRooms.find((room) => room.ticket === cleanTicket) || null;

      if (!roomForTheme) {
        roomForTheme = await api.getRoomByTicket(cleanTicket).catch(() => null);
      }

      if (roomForTheme) {
        const nextPromos = promosFromDb || roomForTheme.promos || promoSlides || createEmptyPromoSlides();
        const roomWithPromos = { ...roomForTheme, promos: nextPromos };

        setCurrentPrivateRoom(roomWithPromos);
        setPromoSlides(nextPromos);
        setPrivateRooms((current) => {
          const exists = current.some((room) => room.ticket === cleanTicket);
          return exists
            ? current.map((room) => (room.ticket === cleanTicket ? { ...room, ...roomWithPromos } : room))
            : [roomWithPromos, ...current];
        });
      } else if (promosFromDb) {
        setPromoSlides(promosFromDb);
      }

      const playing = songs.find((song) => song.status === "playing") || null;
      setQueue(songs);
      setCurrentSong(playing);
      setKaraokePaused(Boolean(session?.karaokePaused));
    } catch (error) {
      console.error("Error sincronizando sala desde Supabase:", error);
    }
  };

  useEffect(() => {
    if (!roomCode || !["mobile", "admin", "tv", "lobby"].includes(screen)) return;

    let alive = true;

    const sync = async () => {
      if (!alive) return;
      await refreshRoomFromSupabase("effect");
    };

    sync();

    const unsubscribe = api.subscribeRoom(roomCode, () => {
      sync();
    });

    const cleanupInterval = setInterval(() => {
      api.cleanupInactiveUsersAndTurns(roomCode).catch((error) => {
        console.error("Error limpiando usuarios inactivos:", error);
      });
      sync();
    }, 12000);

    return () => {
      alive = false;
      unsubscribe?.();
      clearInterval(cleanupInterval);
    };
  }, [roomCode, screen]);

  useEffect(() => {
    if (!roomCode || !["mobile", "admin", "tv", "lobby"].includes(screen)) {
      setActiveRoomUsers([]);
      return;
    }

    const syncUsers = async () => {
      try {
        const users = await api.listActiveUsers(roomCode);
        setActiveRoomUsers(users);
        setRoomUsersClock((current) => current + 1);
      } catch (error) {
        console.error("Error cargando usuarios activos desde Supabase:", error);
      }
    };

    syncUsers();
    const interval = setInterval(syncUsers, 5000);

    return () => clearInterval(interval);
  }, [roomCode, screen]);

  useEffect(() => {
    if (screen !== "mobile" || !roomCode || !selectedAvatar || !playerName.trim()) return;

    const userData = {
      name: playerName.trim(),
      avatar: selectedAvatar.icon,
      avatarName: selectedAvatar.name,
      displayName: getUserDisplayName(),
      roomCode,
    };

    const sendHeartbeat = async () => {
      try {
        await api.heartbeatUser(roomCode, playerId, userData);
      } catch (error) {
        console.error("Error guardando usuario activo en Supabase:", error);
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 10000);

    return () => {
      clearInterval(interval);
    };
  }, [screen, roomCode, selectedAvatar, playerName, playerId]);

  useEffect(() => {
    if (urlHandledRef.current) return;
    if (!roomsLoaded) return;

    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const section = pathParts[0]?.toLowerCase();
    const ticketFromUrl = pathParts[1];

    const goHome = () => {
      urlHandledRef.current = true;
      hideScreenLoading();
      setScreen("home");
    };

    const openRouteRoom = async (target, title, message) => {
      urlHandledRef.current = true;
      showScreenLoading(title, message);

      try {
        const opened = await activatePrivateRoomByTicket(ticketFromUrl, "qr", target);
        if (!opened) {
          await openPublicRoomByCode(ticketFromUrl, target);
        }
      } finally {
        hideScreenLoading();
      }
    };

    if (!section) {
      const savedSession = loadAppSession();

      if (savedSession?.screen && savedSession.screen !== "boot") {
        urlHandledRef.current = true;
        hideScreenLoading();
        setScreen(savedSession.screen);
        return;
      }

      goHome();
      return;
    }

    if (section === "dev") {
      urlHandledRef.current = true;
      hideScreenLoading();
      setScreen("dev");
      return;
    }

    if (!ticketFromUrl) {
      goHome();
      return;
    }

    if (section === "qr" || section === "lobby") {
      openRouteRoom("lobby", "Abriendo QR", "Preparando el acceso de la sala...");
      return;
    }

    if (section === "sala") {
      openRouteRoom("avatar", "Entrando a la sala", "Cargando la configuración del local...");
      return;
    }

    if (section === "tv") {
      openRouteRoom("tv", "Preparando TV", "Cargando pantalla del evento...");
      return;
    }

    if (section === "admin") {
      urlHandledRef.current = true;
      showScreenLoading("Validando admin", "Revisando acceso de administrador...");

      const cleanTicket = makeTicket(ticketFromUrl);
      const privateRoom = privateRooms.find((room) => room.ticket === cleanTicket);

      if (privateRoom) {
        if (hasRememberedAdminAccess(cleanTicket)) {
          activatePrivateRoomByTicket(cleanTicket, "qr", "admin")
            .finally(() => hideScreenLoading());
        } else {
          hideScreenLoading();
          setAdminAccessModal({
            open: true,
            ticket: cleanTicket,
            pin: "",
            error: "",
          });
        }

        return;
      }

      openPublicRoomByCode(ticketFromUrl, "admin").finally(() => hideScreenLoading());
      return;
    }

    goHome();
  }, [privateRooms, roomsLoaded]);


  useEffect(() => {
    const handleSecretAccess = (event) => {
      if (!event.ctrlKey || !event.shiftKey) return;

      const key = event.key.toLowerCase();

      if (key === "d") {
        event.preventDefault();
        setScreen("dev");
      }

      if (key === "a") {
        event.preventDefault();
        setAdminAccessModal({
          open: true,
          ticket: "",
          pin: "",
          error: "",
        });
      }
    };

    window.addEventListener("keydown", handleSecretAccess);

    return () => {
      window.removeEventListener("keydown", handleSecretAccess);
    };
  }, []);

  const brandRoom = currentPrivateRoom;
  const brandName = brandRoom?.businessName || "SPACEOKE";
  const brandLogo = brandRoom?.logo || "";
  const appThemeStyle = brandRoom
    ? {
        "--primary": brandRoom.theme?.primary || "#8b5cf6",
        "--primary2": brandRoom.theme?.secondary || "#ec4899",
        "--bg": brandRoom.theme?.background || "#070713",
      }
    : undefined;

  const openQrInNewTab = () => {
    const cleanTicket = makeTicket(roomCode);
    if (!cleanTicket) return;
    window.open(`${window.location.origin}/qr/${cleanTicket}`, "_blank", "noopener,noreferrer");
  };

  const updatePrivateRoom = async (roomId, updater) => {
    const currentRoom = privateRooms.find((room) => room.id === roomId);
    if (!currentRoom) return;

    const updatedCandidate =
      typeof updater === "function" ? updater(currentRoom) : { ...currentRoom, ...updater };

    const nextLocalRoom = {
      ...currentRoom,
      ...updatedCandidate,
      theme: {
        ...currentRoom.theme,
        ...(updatedCandidate.theme || {}),
      },
      stats: {
        ...currentRoom.stats,
        ...(updatedCandidate.stats || {}),
      },
    };

    setPrivateRooms((current) =>
      current.map((room) => (room.id === roomId ? nextLocalRoom : room))
    );

    if (currentPrivateRoom?.id === roomId) {
      setCurrentPrivateRoom(nextLocalRoom);
      setPromoSlides(nextLocalRoom.promos || promoSlides || createEmptyPromoSlides());
    }

    try {
      const savedRoom = await api.updatePrivateRoom(roomId, {
        ticket: nextLocalRoom.ticket,
        adminPin: nextLocalRoom.adminPin,
        businessName: nextLocalRoom.businessName,
        publicTitle: nextLocalRoom.publicTitle,
        slogan: nextLocalRoom.slogan,
        instagram: nextLocalRoom.instagram,
        location: nextLocalRoom.location,
        logo: nextLocalRoom.logo,
        expiresAt: nextLocalRoom.expiresAt,
        primary: nextLocalRoom.theme?.primary,
        secondary: nextLocalRoom.theme?.secondary,
        background: nextLocalRoom.theme?.background,
      });

      const mergedRoom = {
        ...nextLocalRoom,
        ...savedRoom,
        promos: nextLocalRoom.promos || savedRoom.promos,
        stats: nextLocalRoom.stats || savedRoom.stats,
      };

      setPrivateRooms((current) =>
        current.map((room) => (room.id === roomId ? mergedRoom : room))
      );

      if (currentPrivateRoom?.id === roomId) {
        setCurrentPrivateRoom(mergedRoom);
      }
    } catch (error) {
      console.error("Error actualizando sala privada", error);
      openConfirmModal({
        title: "No se pudo guardar",
        message: error.message || "Hubo un problema guardando los cambios en Supabase.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
      loadPrivateRoomsFromSupabase();
    }
  };

  const recordSongPlayedForPrivateRoom = () => {
    if (!currentPrivateRoom) return;

    updatePrivateRoom(currentPrivateRoom.id, (room) => ({
      ...room,
      stats: {
        ...room.stats,
        totalSongsPlayed: (room.stats?.totalSongsPlayed || 0) + 1,
        totalSingers: Math.max(room.stats?.totalSingers || 0, stats.singers),
        lastActivity: nowIso(),
      },
    }));
  };

  const setPromoSlidesAndPersist = (updater) => {
    setPromoSlides((current) => {
      const nextPromos = typeof updater === "function" ? updater(current) : updater;
      const cleanTicket = makeTicket(roomCode || currentPrivateRoom?.ticket);

      if (currentPrivateRoom) {
        setPrivateRooms((rooms) =>
          rooms.map((room) =>
            room.id === currentPrivateRoom.id
              ? {
                  ...room,
                  promos: nextPromos,
                  stats: {
                    ...room.stats,
                    lastActivity: nowIso(),
                  },
                }
              : room
          )
        );

        setCurrentPrivateRoom((room) =>
          room
            ? {
                ...room,
                promos: nextPromos,
                stats: {
                  ...room.stats,
                  lastActivity: nowIso(),
                },
              }
            : room
        );
      }

      if (cleanTicket) {
        nextPromos.forEach((promo, index) => {
          api.savePromo(cleanTicket, index + 1, promo).catch((error) => {
            console.error(`Error guardando Promo ${index + 1} en Supabase:`, error);
          });
        });
      }

      return nextPromos;
    });
  };

  const openPublicRoomByCode = async (input, target = "avatar") => {
    const publicCode = makeTicket(input);
    if (!publicCode) return false;

    try {
      const existingSession = await api.getRoomSession(publicCode);
      if (existingSession && existingSession.active === false) {
        openConfirmModal({
          title: "Sala cerrada",
          message: "Esta sala pública fue cerrada por el administrador.",
          confirmText: "Entendido",
          cancelText: "",
          danger: true,
          onConfirm: () => {},
        });
        setScreen("home");
        return true;
      }

      const session = await api.ensureRoomSession(publicCode, { isPublic: true });

      if (session && session.active === false) {
        openConfirmModal({
          title: "Sala cerrada",
          message: "Esta sala pública fue cerrada por el administrador.",
          confirmText: "Entendido",
          cancelText: "",
          danger: true,
          onConfirm: () => {},
        });
        setScreen("home");
        return true;
      }
    } catch (error) {
      console.error("Error preparando sala pública", error);
    }

    setCurrentPrivateRoom(null);
    setLobbyBackTarget("home");
    setRoomCode(publicCode);
    setPromoSlides(createEmptyPromoSlides());
    setKaraokePaused(false);

    if (target === "avatar") {
      const savedProfile = loadRoomProfile(publicCode);

      if (savedProfile) {
        setSelectedAvatar(savedProfile.selectedAvatar);
        setPlayerName(savedProfile.playerName);
        setPlayerId(savedProfile.playerId);
        setSearchText("");
        clearYoutubeSearch();
        setScreen("mobile");
      } else {
        clearRoomProfile(roomCode);
        setSelectedAvatar(null);
        setPlayerName("");
        setSearchText("");
        clearYoutubeSearch();
        resetPlayerId();
        setScreen("avatar");
      }
    } else if (target === "admin") {
      setAdminTab("queue");
      setScreen("admin");
    } else if (target === "tv") {
      setScreen("tv");
    } else {
      setScreen("lobby");
    }

    return true;
  };

  const activatePrivateRoomByTicket = async (input, source = "home", target = "lobby") => {
    const ticket = makeTicket(input);
    let room = privateRooms.find((item) => item.ticket === ticket);

    if (!room) {
      room = await api.getRoomByTicket(ticket).catch(() => null);

      if (room) {
        setPrivateRooms((current) => {
          const exists = current.some((item) => item.ticket === ticket);
          return exists ? current.map((item) => (item.ticket === ticket ? room : item)) : [room, ...current];
        });
      }
    }

    if (!room) return false;

    if (!isRoomUsable(room)) {
      openConfirmModal({
        title: "Sala no activa",
        message:
          "Esta sala está vencida o desactivada. Contacta al administrador para renovar el servicio.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
      return true;
    }

    const roomWithSession = {
      ...room,
      stats: {
        ...room.stats,
        totalSessions: (room.stats?.totalSessions || 0) + 1,
        lastActivity: nowIso(),
      },
    };

    setPrivateRooms((current) =>
      current.map((item) => (item.id === room.id ? roomWithSession : item))
    );

    try {
      await api.ensureRoomSession(roomWithSession.ticket, { isPublic: false, reopen: true });
    } catch (error) {
      console.warn("No se pudo preparar la sesión de sala privada", error);
    }

    let promos = roomWithSession.promos || createEmptyPromoSlides();

    try {
      promos = await api.listPromos(roomWithSession.ticket);
    } catch (error) {
      console.warn("No se pudieron cargar las promos de la sala", error);
    }

    setCurrentPrivateRoom({ ...roomWithSession, promos });
    setLobbyBackTarget(source === "dev" ? "dev" : "home");
    setRoomCode(roomWithSession.ticket);
    setPromoSlides(promos || createEmptyPromoSlides());
    setQueue([]);
    setCurrentSong(null);
    setKaraokePaused(false);

    if (target === "avatar") {
      const savedProfile = loadRoomProfile(roomWithSession.ticket);

      if (savedProfile) {
        setSelectedAvatar(savedProfile.selectedAvatar);
        setPlayerName(savedProfile.playerName);
        setPlayerId(savedProfile.playerId);
        setSearchText("");
        clearYoutubeSearch();
        setScreen("mobile");
      } else {
        setSelectedAvatar(null);
        setPlayerName("");
        setSearchText("");
        resetPlayerId();
        setScreen("avatar");
      }
    } else if (target === "admin") {
      setAdminTab("queue");
      setScreen("admin");
    } else if (target === "tv") {
      setScreen("tv");
    } else {
      setScreen("lobby");
    }

    return true;
  };

  const createPrivateRoom = async (form) => {
    const ticket = makeTicket(form.ticket || form.businessName || `LOCAL${Date.now()}`);

    if (privateRooms.some((room) => room.ticket === ticket)) {
      openConfirmModal({
        title: "Ticket repetido",
        message: "Ya existe una sala privada con ese ticket. Usa otro código.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    try {
      const newRoom = await api.createPrivateRoom({
        ...form,
        ticket,
      });

      const promos = await api.listPromos(newRoom.ticket);
      const roomWithPromos = { ...newRoom, promos };

      setPrivateRooms((current) => [roomWithPromos, ...current]);
      setDevEditingRoomId(newRoom.id);

      openConfirmModal({
        title: "Sala creada",
        message: `La sala ${newRoom.businessName} fue guardada en Supabase con el ticket ${newRoom.ticket}.`,
        confirmText: "Perfecto",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
    } catch (error) {
      console.error("Error creando sala", error);
      openConfirmModal({
        title: "No se pudo crear la sala",
        message: error.message || "Verifica Supabase y vuelve a intentar.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
    }
  };

  const renewPrivateRoom = async (roomId, days = 30) => {
    try {
      const updatedRoom = await api.renewPrivateRoom(roomId, days);
      setPrivateRooms((current) =>
        current.map((room) => (room.id === roomId ? { ...room, ...updatedRoom } : room))
      );

      if (currentPrivateRoom?.id === roomId) {
        setCurrentPrivateRoom((room) => ({ ...room, ...updatedRoom }));
      }
    } catch (error) {
      console.error("Error renovando sala", error);
      openConfirmModal({
        title: "No se pudo renovar",
        message: error.message || "Hubo un problema renovando la sala.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
    }
  };

  const togglePrivateRoom = async (roomId) => {
    const room = privateRooms.find((item) => item.id === roomId);
    if (!room) return;

    try {
      const updatedRoom = await api.togglePrivateRoom(roomId, !room.active);
      setPrivateRooms((current) =>
        current.map((item) => (item.id === roomId ? { ...item, ...updatedRoom } : item))
      );

      if (currentPrivateRoom?.id === roomId) {
        setCurrentPrivateRoom((current) => ({ ...current, ...updatedRoom }));
      }
    } catch (error) {
      console.error("Error activando/desactivando sala", error);
      openConfirmModal({
        title: "No se pudo cambiar el estado",
        message: error.message || "Hubo un problema actualizando la sala.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
    }
  };

  const deletePrivateRoom = async (roomId) => {
    try {
      await api.deletePrivateRoom(roomId);
      setPrivateRooms((current) => current.filter((room) => room.id !== roomId));

      if (currentPrivateRoom?.id === roomId) {
        setCurrentPrivateRoom(null);
        setPromoSlides(createEmptyPromoSlides());
      }
    } catch (error) {
      console.error("Error eliminando sala", error);
      openConfirmModal({
        title: "No se pudo eliminar",
        message: error.message || "Hubo un problema eliminando la sala.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
    }
  };


  const activeQueue = queue.filter((song) =>
    ACTIVE_STATUSES.includes(song.status)
  );

  const history = queue.filter((song) =>
    HISTORY_STATUSES.includes(song.status)
  );

  const myActiveTurn = activeQueue.find((song) => song.ownerId === playerId);
  const myLatestVideoError = queue
    .filter((song) => song.ownerId === playerId && song.status === "video_error" && !song.retriedAfterError)
    .sort((a, b) => new Date(b.endedAt || b.requestedAt || 0) - new Date(a.endedAt || a.requestedAt || 0))[0];
  const hasActiveTurn = Boolean(myActiveTurn);

  const stats = {
    active: activeQueue.length,
    history: history.length,
    done: history.filter((song) => song.status === "done").length,
    noShow: history.filter((song) => song.status === "no_show").length,
    cancelled: history.filter((song) => song.status === "cancelled").length,
    singers: new Set(
      queue
        .filter((song) => song.status === "done" || song.status === "playing")
        .map((song) => song.user)
    ).size,
    users: activeRoomUsers.length,
  };

  const resetPlayerId = () => {
    setPlayerId(`player-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  };

  const openConfirmModal = ({
    title,
    message,
    confirmText = "Aceptar",
    cancelText = "Cancelar",
    danger = false,
    onConfirm,
  }) => {
    setConfirmModal({
      open: true,
      title,
      message,
      confirmText,
      cancelText,
      danger,
      onConfirm,
    });
  };

  const closeConfirmModal = () => {
    setConfirmModal({
      open: false,
      title: "",
      message: "",
      confirmText: "Aceptar",
      cancelText: "Cancelar",
      danger: false,
      onConfirm: null,
    });
  };

  const acceptConfirmModal = () => {
    if (confirmModal.onConfirm) {
      confirmModal.onConfirm();
    }

    closeConfirmModal();
  };

  const promoteNextFromQueue = (list) => {
    const nextQueuedSong = list.find((song) => song.status === "queued");

    if (!nextQueuedSong) {
      return {
        newQueue: list,
        newCurrentSong: null,
      };
    }

    const nextPlayingSong = {
      ...nextQueuedSong,
      status: "playing",
      startedAt: nowIso(),
      endedAt: null,
    };

    const newQueue = list.map((song) =>
      song.id === nextPlayingSong.id ? nextPlayingSong : song
    );

    return {
      newQueue,
      newCurrentSong: nextPlayingSong,
    };
  };

  const insertAfterQueuedSongs = (list, songToInsert, queuedSlots = 2) => {
    const result = [];
    let queuedSeen = 0;
    let inserted = false;

    for (const song of list) {
      result.push(song);

      if (song.status === "queued") {
        queuedSeen += 1;
      }

      if (!inserted && queuedSeen >= queuedSlots) {
        result.push(songToInsert);
        inserted = true;
      }
    }

    if (!inserted) {
      result.push(songToInsert);
    }

    return result;
  };

  const isDuplicateActiveVersion = (versionKey, ignoreSongId = null) => {
    return queue.some((song) => {
      if (song.id === ignoreSongId) return false;

      return (
        ACTIVE_STATUSES.includes(song.status) &&
        song.versionKey === versionKey
      );
    });
  };

  const randomCode = async () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    showScreenLoading("Creando sala", "Preparando sala pública en Supabase...");

    try {
      await api.ensureRoomSession(code, { isPublic: true, reopen: true });
      setCurrentPrivateRoom(null);
      setLobbyBackTarget("home");
      setPromoSlides(createEmptyPromoSlides());
      setQueue([]);
      setCurrentSong(null);
      setKaraokePaused(false);
      setRoomCode(code);
      setScreen("lobby");
    } catch (error) {
      console.error("Error creando sala pública", error);
      openConfirmModal({
        title: "No se pudo crear la sala",
        message: error.message || "Hubo un problema creando la sala pública.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
    } finally {
      hideScreenLoading();
    }
  };

  const joinRoom = async () => {
    const cleanRoomCode = roomCode.trim();

    if (cleanRoomCode.length < 4) return;

    showScreenLoading("Buscando sala", "Verificando ticket y preparando tu entrada...");

    try {
      if (await activatePrivateRoomByTicket(cleanRoomCode, "home", "avatar")) {
        return;
      }

      await openPublicRoomByCode(cleanRoomCode, "avatar");
    } finally {
      hideScreenLoading();
    }
  };

  const getUserDisplayName = () => {
    if (!selectedAvatar || !playerName.trim()) {
      return "Invitado";
    }

    return `${selectedAvatar.name} ${playerName.trim()}`;
  };

  const clearYoutubeSearch = () => {
    setYoutubeSearchResults([]);
    setYoutubeSearchState({ loading: false, message: "", fromCache: false });
  };

  const clearYoutubeLocalCache = () => {
    setYoutubeCatalog([]);
    setBlockedYoutubeVideos([]);
    setYoutubeSearchResults([]);
    setYoutubeSearchState({ loading: false, message: "", fromCache: false });
    removeJsonStorage(YOUTUBE_SEARCH_CACHE_KEY);
    removeJsonStorage(YOUTUBE_VIDEO_CATALOG_KEY);
    removeJsonStorage(YOUTUBE_BLOCKED_VIDEOS_KEY);
  };

  const blockYoutubeVideo = (songOrVideo, reason = "YouTube no permitió reproducir este video") => {
    const youtubeId = songOrVideo?.youtubeId;
    if (!youtubeId) return;

    const blockedVideo = {
      youtubeId,
      title: songOrVideo.title || "Video bloqueado",
      channelTitle: songOrVideo.artist || songOrVideo.channelTitle || "YouTube",
      url: songOrVideo.youtubeUrl || songOrVideo.url || youtubeUrlFromId(youtubeId),
      reason,
      blockedAt: nowIso(),
    };

    setBlockedYoutubeVideos((current) => {
      if (current.some((item) => item.youtubeId === youtubeId)) return current;
      return [blockedVideo, ...current];
    });

    setYoutubeCatalog((current) =>
      current.map((video) =>
        video.youtubeId === youtubeId
          ? {
              ...video,
              blocked: true,
              blockedAt: nowIso(),
              blockedReason: reason,
            }
          : video
      )
    );

    const searchCache = loadJsonStorage(YOUTUBE_SEARCH_CACHE_KEY, {});
    const cleanedCache = Object.fromEntries(
      Object.entries(searchCache).map(([query, cached]) => [
        query,
        {
          ...cached,
          results: (cached.results || []).filter((video) => video.youtubeId !== youtubeId),
        },
      ])
    );
    saveJsonStorage(YOUTUBE_SEARCH_CACHE_KEY, cleanedCache);

    setYoutubeSearchResults((current) =>
      current.filter((video) => video.youtubeId !== youtubeId)
    );
  };

  const handleVideoPlaybackErrorAndSkip = async (song, reason = "No se pudo reproducir este video") => {
    if (!song?.id || !roomCode) return;

    try {
      await api.markVideoErrorAndSkip(roomCode, song, reason);
      await refreshRoomFromSupabase("video-error");
    } catch (error) {
      console.error("Error marcando video fallido", error);
    }
  };

  const addLocalVideoToCatalog = async (localVideo) => {
    const cleanUrl = localVideo?.localVideoUrl?.trim();
    if (!cleanUrl) {
      openConfirmModal({
        title: "Falta el video local",
        message: "Agrega una ruta local o URL del archivo MP4 para guardar esta canción.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    try {
      const newVideo = await api.addLocalVideo({
        title: localVideo.title,
        channelTitle: localVideo.channelTitle,
        localVideoUrl: cleanUrl,
        thumbnail: localVideo.thumbnail,
        searchQuery: localVideo.searchQuery,
        originalYoutubeId: localVideo.originalYoutubeId,
      });

      setYoutubeCatalog((current) => [newVideo, ...current.filter((item) => item.youtubeId !== newVideo.youtubeId)]);
      setBlockedYoutubeVideos(await api.listBlockedVideos());

      setYoutubeSearchState({
        loading: false,
        message: "Versión local agregada. Ya puede aparecer en búsqueda y reproducirse en TV.",
        fromCache: true,
      });
    } catch (error) {
      console.error("Error agregando video local", error);
      openConfirmModal({
        title: "No se pudo guardar el video",
        message: error.message || "Hubo un problema guardando el video local.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
    }
  };

  const upsertYoutubeCatalog = (videos) => {
    setYoutubeCatalog((current) => {
      const map = new Map(current.map((video) => [video.youtubeId, video]));

      videos.forEach((video) => {
        if (!video.youtubeId) return;
        const existing = map.get(video.youtubeId);
        map.set(video.youtubeId, {
          ...existing,
          ...video,
          playCount: existing?.playCount || video.playCount || 0,
          requestedCount: existing?.requestedCount || video.requestedCount || 0,
          createdAt: existing?.createdAt || video.createdAt || nowIso(),
        });
      });

      return Array.from(map.values()).sort((a, b) =>
        (b.requestedCount || 0) - (a.requestedCount || 0)
      );
    });
  };

  const markVideoRequested = async (video) => {
    try {
      await api.markVideoRequested(video);
      const catalog = await api.listVideoCatalog();
      setYoutubeCatalog(catalog);
    } catch (error) {
      console.error("Error marcando video pedido", error);
    }
  };

  const searchKaraokeSongs = async () => {
    if (hasActiveTurn) {
      openConfirmModal({
        title: "Turno activo",
        message: "Ya tienes una canción en cola o sonando. Debes esperar a que termine o cancelar tu turno.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    const query = normalizeSearchQuery(searchText);

    if (query.length < 4) {
      setYoutubeSearchState({ loading: false, message: "Escribe al menos 4 caracteres para buscar.", fromCache: false });
      return;
    }

    const lastSearch = Number(sessionStorage.getItem("spaceoke_last_youtube_search") || 0);
    const elapsed = Date.now() - lastSearch;

    if (elapsed < SEARCH_COOLDOWN_MS) {
      const seconds = Math.ceil((SEARCH_COOLDOWN_MS - elapsed) / 1000);
      setYoutubeSearchState({ loading: false, message: `Espera ${seconds}s antes de buscar otra vez. Esto protege tu API.`, fromCache: false });
      return;
    }

    const catalogMatches = youtubeCatalog
      .filter((video) => !video.blocked && !isYoutubeIdBlocked(video.youtubeId, blockedYoutubeVideos))
      .filter((video) => normalizeSearchQuery(`${video.title} ${video.channelTitle}`).includes(query.replace(" karaoke", "")))
      .slice(0, MAX_YOUTUBE_RESULTS);

    if (catalogMatches.length > 0) {
      setYoutubeSearchResults(catalogMatches);
      setYoutubeSearchState({ loading: false, message: "Resultados encontrados en tu catálogo local. No se gastó API.", fromCache: true });
      return;
    }

    setYoutubeSearchState({ loading: true, message: "Buscando karaokes...", fromCache: false });
    sessionStorage.setItem("spaceoke_last_youtube_search", String(Date.now()));

    try {
      let results = await api.searchKaraoke(query);
      results = filterBlockedYoutubeVideos(results, blockedYoutubeVideos)
        .filter((video) => video.youtubeId && looksLikeKaraoke(video))
        .sort((a, b) => scoreKaraokeVideo(b) - scoreKaraokeVideo(a))
        .slice(0, MAX_YOUTUBE_RESULTS);

      if (results.length === 0) {
        setYoutubeSearchResults([]);
        setYoutubeSearchState({ loading: false, message: "No encontré resultados claramente karaoke. Prueba con artista + canción.", fromCache: false });
        return;
      }

      setYoutubeSearchResults(results);
      setYoutubeSearchState({ loading: false, message: "Resultados nuevos desde YouTube. Quedaron listos para pedir.", fromCache: false });
    } catch (error) {
      const results = filterBlockedYoutubeVideos(demoYoutubeResults(query), blockedYoutubeVideos);
      setYoutubeSearchResults(results);
      setYoutubeSearchState({
        loading: false,
        message: "No se pudo usar la función de YouTube. Mostrando modo demo mientras configuras youtube-search.",
        fromCache: true,
      });
    }
  };

  const requestSongFromVideo = async (video) => {
    if (hasActiveTurn) {
      openConfirmModal({
        title: "Turno activo",
        message: "Ya tienes una canción en cola o sonando. Debes esperar a que termine o cancelar tu turno.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    const versionKey = normalizeSongKey(video.localVideoUrl || video.youtubeId || video.title);

    if (isDuplicateActiveVersion(versionKey)) {
      openConfirmModal({
        title: "Canción repetida",
        message: "Esta misma versión ya está en cola o sonando. Elige otra versión o espera a que termine.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    const newSong = {
      ownerId: playerId,
      title: video.title,
      artist: video.channelTitle || "YouTube Karaoke",
      user: getUserDisplayName(),
      avatar: selectedAvatar?.icon || "🎤",
      duration: video.duration || "—",
      retryCount: 0,
      versionKey,
      youtubeId: video.youtubeId,
      youtubeUrl: video.url || (video.youtubeId ? youtubeUrlFromId(video.youtubeId) : ""),
      localVideoUrl: video.localVideoUrl || video.localUrl || "",
      source: video.source || (video.localVideoUrl ? "local" : "youtube-api"),
      thumbnail: video.thumbnail || "",
    };

    try {
      await api.addSong(roomCode, newSong);
      await markVideoRequested(video);
      await refreshRoomFromSupabase("request-song");
      setSearchText("");
      clearYoutubeSearch();
    } catch (error) {
      console.error("Error pidiendo canción", error);
      openConfirmModal({
        title: "No se pudo pedir la canción",
        message: error.message || "Hubo un problema guardando la canción en la cola.",
        confirmText: "Entendido",
        cancelText: "",
        danger: true,
        onConfirm: () => {},
      });
    }
  };

  const addDemoSong = () => {
    searchKaraokeSongs();
  };

  const nextSong = async () => {
    if (!roomCode) return;
    try {
      await api.nextSong(roomCode, currentSong?.id);
      if (currentSong) recordSongPlayedForPrivateRoom();
      await refreshRoomFromSupabase("next");
    } catch (error) {
      console.error("Error pasando a siguiente", error);
    }
  };

  const deleteSong = async (songId) => {
    if (!roomCode) return;
    try {
      await api.cancelSongAndPromote(roomCode, songId);
      await refreshRoomFromSupabase("delete");
    } catch (error) {
      console.error("Error eliminando canción", error);
    }
  };

  const repeatCurrentSong = async () => {
    if (!currentSong) return;
    try {
      await api.repeatSong(currentSong.id);
      await refreshRoomFromSupabase("repeat");
    } catch (error) {
      console.error("Error repitiendo canción", error);
    }
  };

  const moveSongUp = async (songId) => {
    if (!roomCode) return;
    try {
      await api.moveSongUp(roomCode, songId);
      await refreshRoomFromSupabase("move-up");
    } catch (error) {
      console.error("Error adelantando canción", error);
    }
  };

  const playSongNow = (songId) => {
    const selectedSong = queue.find((song) => song.id === songId);
    if (!selectedSong) return;

    openConfirmModal({
      title: "Tocar ahora",
      message: "¿Seguro que quieres poner esta canción ahora? La canción actual será reemplazada.",
      confirmText: "Tocar ahora",
      cancelText: "Cancelar",
      danger: false,
      onConfirm: async () => {
        try {
          await api.playSongNow(roomCode, songId);
          await refreshRoomFromSupabase("play-now");
        } catch (error) {
          console.error("Error tocando ahora", error);
        }
      },
    });
  };

  const markCurrentAsNoShow = () => {
    if (!currentSong) return;

    openConfirmModal({
      title: "Marcar como no apareció",
      message: "La canción saldrá de reproducción y se reintentará más abajo en la cola si todavía tiene reintentos disponibles.",
      confirmText: "No apareció",
      cancelText: "Cancelar",
      danger: true,
      onConfirm: async () => {
        try {
          await api.markNoShowAndPromote(roomCode, currentSong, MAX_RETRIES);
          await refreshRoomFromSupabase("no-show");
          setAdminTab("queue");
        } catch (error) {
          console.error("Error marcando no apareció", error);
        }
      },
    });
  };

  const reinsertFromHistory = async (songId) => {
    const song = queue.find((item) => item.id === songId);
    if (!song) return;

    if (song.retryCount >= MAX_RETRIES) {
      openConfirmModal({
        title: "Límite de reintentos",
        message: "Esta canción ya alcanzó el máximo de reintentos permitidos.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    if (isDuplicateActiveVersion(song.versionKey)) {
      openConfirmModal({
        title: "Canción repetida",
        message: "Esta misma versión ya está en cola o sonando. Elige otra versión o espera a que termine.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    try {
      await api.reinsertSong(roomCode, song);
      await refreshRoomFromSupabase("reinsert");
      setAdminTab("queue");
    } catch (error) {
      console.error("Error reinsertando canción", error);
    }
  };

  const cancelMyTurn = () => {
    if (!hasActiveTurn) {
      openConfirmModal({
        title: "Sin turno activo",
        message: "No tienes ningún turno activo para cancelar.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    openConfirmModal({
      title: "Cancelar mi turno",
      message: "Tu canción será eliminada de la cola, pero seguirás dentro de la sala.",
      confirmText: "Cancelar turno",
      cancelText: "Conservar turno",
      danger: true,
      onConfirm: async () => {
        try {
          await api.cancelSongsByOwner(roomCode, playerId);
          await refreshRoomFromSupabase("cancel-my-turn");
        } catch (error) {
          console.error("Error cancelando turno", error);
        }
      },
    });
  };

  const deleteRoomAndReturnHome = async () => {
    try {
      if (roomCode) {
        await api.closeRoom(roomCode);
      }
      if (roomCode && playerId) {
        await api.removeUser(roomCode, playerId);
      }
    } catch (error) {
      console.error("Error cerrando sala", error);
    }

    setQueue([]);
    setCurrentSong(null);
    setRoomCode("");
    setSelectedAvatar(null);
    setPlayerName("");
    setSearchText("");
    setAdminTab("queue");
    setKaraokePaused(false);
    setCurrentPrivateRoom(null);
    setPromoSlides(createEmptyPromoSlides());
    resetPlayerId();
    setScreen("home");
  };

  const confirmDeleteRoom = () => {
    openConfirmModal({
      title: "Cerrar sala",
      message: "Si sales, se cerrará la sala pública y los usuarios volverán a la página principal.",
      confirmText: "Cerrar sala",
      cancelText: "Seguir aquí",
      danger: true,
      onConfirm: deleteRoomAndReturnHome,
    });
  };

  const removeMyTurnAndReturnHome = () => {
    openConfirmModal({
      title: "Salir de la sala",
      message: "Si sales, se eliminará tu turno activo de la cola. Podrás volver a entrar con el PIN si lo necesitas.",
      confirmText: "Salir y eliminar turno",
      cancelText: "Quedarme",
      danger: true,
      onConfirm: async () => {
        try {
          await api.cancelSongsByOwner(roomCode, playerId);
          await api.removeUser(roomCode, playerId);
        } catch (error) {
          console.error("Error saliendo de la sala", error);
        }

        setSelectedAvatar(null);
        setPlayerName("");
        setSearchText("");
        resetPlayerId();
        setScreen("home");
      },
    });
  };

  const openPrivateAdminAccess = () => {
    setAdminAccessModal({
      open: true,
      ticket: "",
      pin: "",
      error: "",
    });
  };

  const closePrivateAdminAccess = () => {
    setAdminAccessModal({
      open: false,
      ticket: "",
      pin: "",
      error: "",
    });
  };

  const confirmPrivateAdminAccess = async () => {
    const ticket = makeTicket(adminAccessModal.ticket);
    const room = privateRooms.find((item) => item.ticket === ticket);

    if (!room) {
      setAdminAccessModal((current) => ({
        ...current,
        error: "No existe una sala privada con ese ticket.",
      }));
      return;
    }

    if (!isRoomUsable(room)) {
      setAdminAccessModal((current) => ({
        ...current,
        error: "Esta sala está vencida o desactivada.",
      }));
      return;
    }

    if (adminAccessModal.pin.trim() !== (room.adminPin || "5050")) {
      setAdminAccessModal((current) => ({
        ...current,
        error: "PIN incorrecto. Verifica el código del administrador.",
      }));
      return;
    }

    showScreenLoading("Abriendo admin", "Validando el panel del local...");

    try {
      rememberAdminAccess(room.ticket);
      closePrivateAdminAccess();
      await activatePrivateRoomByTicket(room.ticket, "home", "admin");
    } finally {
      hideScreenLoading();
    }
  };

  const requestAdminAccess = () => {
    if (!currentPrivateRoom) {
      setScreen("admin");
      return;
    }

    if (hasRememberedAdminAccess(currentPrivateRoom.ticket)) {
      setScreen("admin");
      return;
    }

    setAdminPinModal({
      open: true,
      pin: "",
      error: "",
    });
  };

  const closeAdminPinModal = () => {
    setAdminPinModal({
      open: false,
      pin: "",
      error: "",
    });
  };

  const confirmAdminPin = () => {
    const expectedPin = currentPrivateRoom?.adminPin || "5050";

    if (adminPinModal.pin.trim() !== expectedPin) {
      setAdminPinModal((current) => ({
        ...current,
        error: "PIN incorrecto. Verifica el código entregado al administrador.",
      }));
      return;
    }

    showScreenLoading("Abriendo admin", "Preparando el panel de control...");

    rememberAdminAccess(currentPrivateRoom?.ticket);
    closeAdminPinModal();

    setTimeout(() => {
      setScreen("admin");
      hideScreenLoading();
    }, 250);
  };

  const continueWithAvatar = () => {
    if (!playerName.trim()) {
      openConfirmModal({
        title: "Nombre requerido",
        message: "Primero escribe tu nombre para entrar a la sala.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    if (!selectedAvatar) {
      openConfirmModal({
        title: "Avatar requerido",
        message: "Elige un avatar para que el admin pueda identificarte.",
        confirmText: "Entendido",
        cancelText: "",
        danger: false,
        onConfirm: () => {},
      });
      return;
    }

    showScreenLoading("Entrando a la sala", "Preparando tu perfil de cantante...");

    saveRoomProfile(roomCode, {
      playerName: playerName.trim(),
      selectedAvatar,
      playerId,
    });

    api.heartbeatUser(roomCode, playerId, {
      name: playerName.trim(),
      avatar: selectedAvatar.icon,
      avatarName: selectedAvatar.name,
      displayName: getUserDisplayName(),
      roomCode,
    })
      .catch((error) => console.error("Error guardando usuario al entrar", error))
      .finally(() => {
        setScreen("mobile");
        hideScreenLoading();
      });
  };

  return (
    <div className="app">
      {screen === "boot" && (
        <FullScreenLoader
          title="SPACEOKE"
          message={roomsLoaded ? "Preparando pantalla..." : "Conectando con Supabase..."}
        />
      )}

      {screenLoading.active && (
        <LoadingOverlay
          title={screenLoading.title}
          message={screenLoading.message}
        />
      )}

      {screen === "home" && roomClosedNotice && (
        <div className="room-closed-toast" role="status" aria-live="polite">
          <div className="room-closed-toast-icon">
            <LogOut size={18} />
          </div>

          <div className="room-closed-toast-copy">
            <strong>Sala cerrada</strong>
            <span>{roomClosedNotice}</span>
          </div>

          <button
            type="button"
            className="room-closed-toast-close"
            onClick={() => setRoomClosedNotice(null)}
            aria-label="Cerrar notificación"
          >
            Entendido
          </button>

          <div className="room-closed-toast-progress" />
        </div>
      )}

      {screen === "home" && (
        <HomeScreen
          onCreate={randomCode}
          roomCode={roomCode}
          setRoomCode={setRoomCode}
          onJoin={joinRoom}
          onDev={() => setScreen("dev")}
          onPrivateAdmin={openPrivateAdminAccess}
        />
      )}

      {screen === "dev" && (
        <DevDashboard
          privateRooms={privateRooms}
          createPrivateRoom={createPrivateRoom}
          updatePrivateRoom={updatePrivateRoom}
          renewPrivateRoom={renewPrivateRoom}
          togglePrivateRoom={togglePrivateRoom}
          deletePrivateRoom={deletePrivateRoom}
          devEditingRoomId={devEditingRoomId}
          setDevEditingRoomId={setDevEditingRoomId}
          onOpenRoom={(room) => activatePrivateRoomByTicket(room.ticket, "dev", "lobby")}
          videoCatalog={youtubeCatalog}
          clearVideoCatalog={clearYoutubeLocalCache}
          addLocalVideoToCatalog={addLocalVideoToCatalog}
          blockedYoutubeVideos={blockedYoutubeVideos}
          roomUsersClock={roomUsersClock}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "lobby" && (
        <LobbyScreen
          roomCode={roomCode}
          brandRoom={brandRoom}
          themeStyle={appThemeStyle}
          onAdmin={requestAdminAccess}
          onTv={() => setScreen("tv")}
          onBack={brandRoom ? () => setScreen(lobbyBackTarget) : confirmDeleteRoom}
        />
      )}

      {screen === "avatar" && (
        <AvatarScreen
          brandName={brandName}
          brandLogo={brandLogo}
          brandRoom={brandRoom}
          themeStyle={appThemeStyle}
          playerName={playerName}
          setPlayerName={setPlayerName}
          selectedAvatar={selectedAvatar}
          setSelectedAvatar={setSelectedAvatar}
          onContinue={continueWithAvatar}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "mobile" && (
        <MobileScreen
          roomCode={roomCode}
          brandRoom={brandRoom}
          brandName={brandName}
          brandLogo={brandLogo}
          themeStyle={appThemeStyle}
          selectedAvatar={selectedAvatar}
          playerName={playerName}
          searchText={searchText}
          setSearchText={setSearchText}
          addDemoSong={addDemoSong}
          searchKaraokeSongs={searchKaraokeSongs}
          requestSongFromVideo={requestSongFromVideo}
          youtubeSearchResults={youtubeSearchResults}
          youtubeSearchState={youtubeSearchState}
          queue={activeQueue}
          myActiveTurn={myActiveTurn}
          myLatestVideoError={myLatestVideoError}
          hasActiveTurn={hasActiveTurn}
          cancelMyTurn={cancelMyTurn}
          onBack={removeMyTurnAndReturnHome}
        />
      )}

      {screen === "admin" && (
        <AdminScreen
          roomCode={roomCode || "4821"}
          brandRoom={brandRoom}
          themeStyle={appThemeStyle}
          brandName={brandName}
          brandLogo={brandLogo}
          queue={activeQueue}
          history={history}
          stats={stats}
          adminTab={adminTab}
          setAdminTab={setAdminTab}
          currentSong={currentSong}
          nextSong={nextSong}
          deleteSong={deleteSong}
          repeatCurrentSong={repeatCurrentSong}
          moveSongUp={moveSongUp}
          playSongNow={playSongNow}
          markCurrentAsNoShow={markCurrentAsNoShow}
          reinsertFromHistory={reinsertFromHistory}
          karaokePaused={karaokePaused}
          setKaraokePaused={async (valueOrUpdater) => {
            const nextValue = typeof valueOrUpdater === "function" ? valueOrUpdater(karaokePaused) : valueOrUpdater;
            setKaraokePaused(nextValue);
            try {
              await api.setRoomPaused(roomCode, nextValue);
            } catch (error) {
              console.error("Error guardando pausa en Supabase", error);
            }
          }}
          promoSlides={promoSlides}
          setPromoSlides={setPromoSlidesAndPersist}
          activePromoIndex={activePromoIndex}
          setActivePromoIndex={setActivePromoIndex}
          onBack={openQrInNewTab}
        />
      )}

      {screen === "tv" && (
        <TvScreen
          roomCode={roomCode || "4821"}
          brandRoom={brandRoom}
          themeStyle={appThemeStyle}
          brandName={brandName}
          brandLogo={brandLogo}
          currentSong={currentSong}
          promoSlides={promoSlides}
          karaokePaused={karaokePaused}
          onVideoPlaybackError={handleVideoPlaybackErrorAndSkip}
          onBack={openQrInNewTab}
        />
      )}

      {adminAccessModal.open && (
        <AdminAccessModal
          ticket={adminAccessModal.ticket}
          pin={adminAccessModal.pin}
          error={adminAccessModal.error}
          setTicket={(ticket) =>
            setAdminAccessModal((current) => ({
              ...current,
              ticket: makeTicket(ticket),
              error: "",
            }))
          }
          setPin={(pin) =>
            setAdminAccessModal((current) => ({
              ...current,
              pin,
              error: "",
            }))
          }
          onConfirm={confirmPrivateAdminAccess}
          onCancel={closePrivateAdminAccess}
        />
      )}

      {adminPinModal.open && (
        <AdminPinModal
          brandName={brandName}
          pin={adminPinModal.pin}
          error={adminPinModal.error}
          setPin={(pin) =>
            setAdminPinModal((current) => ({
              ...current,
              pin,
              error: "",
            }))
          }
          onConfirm={confirmAdminPin}
          onCancel={closeAdminPinModal}
        />
      )}

      {confirmModal.open && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          danger={confirmModal.danger}
          onConfirm={acceptConfirmModal}
          onCancel={closeConfirmModal}
        />
      )}
    </div>
  );
}


function FullScreenLoader({ title = "SPACEOKE", message = "Preparando..." }) {
  return (
    <main className="loading-screen">
      <section className="loading-card">
        <div className="loading-logo">
          <Mic2 size={36} />
        </div>

        <div className="loading-ring" />

        <h2>{title}</h2>
        <p>{message}</p>
      </section>
    </main>
  );
}

function LoadingOverlay({ title = "Procesando", message = "Un momento..." }) {
  return (
    <div className="loading-overlay">
      <section className="loading-card loading-card-small">
        <div className="loading-logo compact">
          <Mic2 size={26} />
        </div>

        <div className="loading-ring small" />

        <h2>{title}</h2>
        <p>{message}</p>
      </section>
    </div>
  );
}

function AdminAccessModal({
  ticket,
  pin,
  error,
  setTicket,
  setPin,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="mk-modal-backdrop">
      <section className="mk-modal admin-pin-modal admin-access-modal">
        <div className="mk-modal-icon">
          <KeyRound size={30} />
        </div>

        <h2>Acceso privado</h2>

        <p>
          Ingresa el ticket del local y el PIN de administrador para abrir su panel.
        </p>

        <input
          className="admin-pin-input"
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
          placeholder="Ticket del local"
          maxLength="14"
          autoFocus
        />

        <input
          className="admin-pin-input"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onConfirm();
            }
          }}
          placeholder="PIN admin"
          type="password"
        />

        {error && <div className="admin-pin-error">{error}</div>}

        <div className="mk-modal-actions">
          <button className="btn dark" onClick={onCancel}>
            Cancelar
          </button>

          <button className="btn primary" onClick={onConfirm}>
            Entrar al admin
          </button>
        </div>
      </section>
    </div>
  );
}

function AdminPinModal({ brandName, pin, error, setPin, onConfirm, onCancel }) {
  return (
    <div className="mk-modal-backdrop">
      <section className="mk-modal admin-pin-modal">
        <div className="mk-modal-icon">
          <KeyRound size={30} />
        </div>

        <h2>PIN de administrador</h2>

        <p>
          Ingresa el PIN de <strong>{brandName}</strong> para abrir el panel de control.
        </p>

        <input
          className="admin-pin-input"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onConfirm();
            }
          }}
          placeholder="Ejemplo: 5050"
          autoFocus
        />

        {error && <div className="admin-pin-error">{error}</div>}

        <div className="mk-modal-actions">
          <button className="btn dark" onClick={onCancel}>
            Cancelar
          </button>

          <button className="btn primary" onClick={onConfirm}>
            Entrar como admin
          </button>
        </div>
      </section>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmText,
  cancelText,
  danger,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="mk-modal-backdrop">
      <section className="mk-modal">
        <div className={`mk-modal-icon ${danger ? "danger" : ""}`}>
          {danger ? <Trash2 size={30} /> : <Zap size={30} />}
        </div>

        <h2>{title}</h2>

        <p>{message}</p>

        <div className={`mk-modal-actions ${!cancelText ? "one-action" : ""}`}>
          {cancelText && (
            <button className="btn dark" onClick={onCancel}>
              {cancelText}
            </button>
          )}

          <button
            className={`btn ${danger ? "danger-btn" : "primary"}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}


function DevDashboard({
  privateRooms,
  createPrivateRoom,
  updatePrivateRoom,
  renewPrivateRoom,
  togglePrivateRoom,
  deletePrivateRoom,
  devEditingRoomId,
  setDevEditingRoomId,
  onOpenRoom,
  videoCatalog = [],
  clearVideoCatalog,
  addLocalVideoToCatalog,
  blockedYoutubeVideos = [],
  roomUsersClock = 0,
  onBack,
}) {
  const logoInputRef = useRef(null);
  const [devTab, setDevTab] = useState("rooms");
  const [form, setForm] = useState({
    businessName: "",
    ticket: "",
    adminPin: "5050",
    publicTitle: "Karaoke Night",
    slogan: "Escanea el QR para pedir tu canción",
    instagram: "",
    location: "",
    logo: "",
    themePreset: "mk",
    primary: themePresets[0].primary,
    secondary: themePresets[0].secondary,
    background: themePresets[0].background,
    expiresAt: getDateAfterDays(30),
  });

  const [localVideoForm, setLocalVideoForm] = useState({
    title: "",
    channelTitle: "Biblioteca local",
    localVideoUrl: "",
    thumbnail: "",
    searchQuery: "",
    originalYoutubeId: "",
  });

  const setLocalVideoField = (field, value) => {
    setLocalVideoForm((current) => ({ ...current, [field]: value }));
  };

  const saveLocalVideoFromDev = () => {
    addLocalVideoToCatalog?.(localVideoForm);
    setLocalVideoForm({
      title: "",
      channelTitle: "Biblioteca local",
      localVideoUrl: "",
      thumbnail: "",
      searchQuery: "",
      originalYoutubeId: "",
    });
  };

  const editingRoom = privateRooms.find((room) => room.id === devEditingRoomId);
  const totalSongs = privateRooms.reduce(
    (total, room) => total + (room.stats?.totalSongsPlayed || 0),
    0
  );
  const totalCachedVideos = videoCatalog.length;
  const totalActiveUsers = privateRooms.reduce((total, room) => total + getActiveUsersForRoom(room.ticket).length, 0);
  const activeRooms = privateRooms.filter((room) => getRoomStatus(room) === "active" || getRoomStatus(room) === "warning").length;
  const expiredRooms = privateRooms.filter((room) => getRoomStatus(room) === "expired").length;

  const syncFormFromRoom = (room) => {
    if (!room) return;

    setForm({
      businessName: room.businessName || "",
      ticket: room.ticket || "",
      adminPin: room.adminPin || "5050",
      publicTitle: room.publicTitle || "Karaoke Night",
      slogan: room.slogan || "Escanea el QR para pedir tu canción",
      instagram: room.instagram || "",
      location: room.location || "",
      logo: room.logo || "",
      themePreset: room.theme?.preset || "mk",
      primary: room.theme?.primary || themePresets[0].primary,
      secondary: room.theme?.secondary || themePresets[0].secondary,
      background: room.theme?.background || themePresets[0].background,
      expiresAt: room.expiresAt || getDateAfterDays(30),
    });
    setDevEditingRoomId(room.id);
    setDevTab("create");
  };

  const resetForm = () => {
    setDevEditingRoomId(null);
    setForm({
      businessName: "",
      ticket: "",
      adminPin: "5050",
      publicTitle: "Karaoke Night",
      slogan: "Escanea el QR para pedir tu canción",
      instagram: "",
      location: "",
      logo: "",
      themePreset: "mk",
      primary: themePresets[0].primary,
      secondary: themePresets[0].secondary,
      background: themePresets[0].background,
      expiresAt: getDateAfterDays(30),
    });
  };

  const setField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "businessName" && !current.ticket
        ? { ticket: makeTicket(value) }
        : {}),
    }));
  };

  const applyThemePreset = (presetId) => {
    const preset = themePresets.find((theme) => theme.id === presetId) || themePresets[0];

    setForm((current) => ({
      ...current,
      themePreset: preset.id,
      primary: preset.primary,
      secondary: preset.secondary,
      background: preset.background,
    }));
  };

  const readLogo = (file) => {
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => setField("logo", reader.result);
    reader.readAsDataURL(file);
  };

  const saveRoom = () => {
    if (!form.businessName.trim()) return;

    if (editingRoom) {
      updatePrivateRoom(editingRoom.id, (room) => ({
        ...room,
        ticket: makeTicket(form.ticket),
        adminPin: form.adminPin || "5050",
        businessName: form.businessName,
        publicTitle: form.publicTitle,
        slogan: form.slogan,
        instagram: form.instagram,
        location: form.location,
        logo: form.logo,
        expiresAt: form.expiresAt,
        theme: {
          preset: form.themePreset,
          primary: form.primary,
          secondary: form.secondary,
          background: form.background,
        },
      }));
    } else {
      createPrivateRoom(form);
    }

    setDevTab("rooms");
  };

  const copyTicket = async (room) => {
    const text = `Sala SPACEOKE lista\nLocal: ${room.businessName}\nTicket: ${room.ticket}\nPIN admin: ${room.adminPin || "5050"}\nVence: ${room.expiresAt}\nEnlace sala: https://mk-karaoke.app/sala/${room.ticket}`;

    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.log(text);
    }
  };

  return (
    <main className="dev-view">
      <aside className="admin-sidebar dev-sidebar">
        <div className="brand mini">
          <div className="brand-icon">
            <Crown size={26} />
          </div>

          <div>
            <h1>Dev Panel</h1>
            <p>Control maestro</p>
          </div>
        </div>

        <button className="btn dark full" onClick={onBack}>
          <LogOut size={18} />
          Volver al inicio
        </button>
      </aside>

      <section className="dev-main">
        <div className="dev-hero">
          <div>
            <span>Panel desarrollador</span>
            <h2>Salas privadas para locales</h2>
            <p>
              Crea tickets, personaliza marca, renueva mensualidades y mira la actividad de cada local.
            </p>
          </div>

          <button
            className="btn primary"
            onClick={() => {
              resetForm();
              setDevTab("create");
            }}
          >
            <Plus size={18} />
            Crear local
          </button>
        </div>

        <div className="dev-stats-grid">
          <div>
            <span>Locales</span>
            <strong>{privateRooms.length}</strong>
          </div>
          <div>
            <span>Activos</span>
            <strong>{activeRooms}</strong>
          </div>
          <div>
            <span>Expirados</span>
            <strong>{expiredRooms}</strong>
          </div>
          <div>
            <span>Canciones tocadas</span>
            <strong>{totalSongs}</strong>
          </div>
          <div>
            <span>Videos cacheados</span>
            <strong>{totalCachedVideos}</strong>
          </div>
        </div>

        <div className="admin-tabs dev-tabs">
          <button className={devTab === "rooms" ? "active" : ""} onClick={() => setDevTab("rooms")}>Locales</button>
          <button className={devTab === "create" ? "active" : ""} onClick={() => setDevTab("create")}>Crear / editar</button>
          <button className={devTab === "monitor" ? "active" : ""} onClick={() => setDevTab("monitor")}>Monitoreo</button>
          <button className={devTab === "catalog" ? "active" : ""} onClick={() => setDevTab("catalog")}>Canciones</button>
        </div>

        {devTab === "rooms" && (
          <div className="dev-room-list">
            {privateRooms.length === 0 && (
              <div className="empty-admin">Aún no tienes locales. Crea el primero y entrégale su ticket.</div>
            )}

            {privateRooms.map((room) => {
              const status = getRoomStatus(room);
              const days = getDaysToExpire(room);

              return (
                <article className="dev-room-card" key={room.id}>
                  <div className="dev-room-brand">
                    <div className="dev-room-logo">
                      {room.logo ? <img src={room.logo} alt={room.businessName} /> : <Crown size={24} />}
                    </div>

                    <div>
                      <span className={`dev-status dev-status-${status}`}>{getRoomStatusLabel(room)}</span>
                      <h3>{room.businessName}</h3>
                      <p>Ticket: {room.ticket} · Vence: {room.expiresAt || "Sin fecha"}</p>
                      {days !== null && <small>{days >= 0 ? `Faltan ${days} días` : `Venció hace ${Math.abs(days)} días`}</small>}
                    </div>
                  </div>

                  <div className="dev-room-metrics">
                    <div><span>Canciones</span><strong>{room.stats?.totalSongsPlayed || 0}</strong></div>
                    <div><span>Sesiones</span><strong>{room.stats?.totalSessions || 0}</strong></div>
                    <div><span>Usuarios</span><strong>{getActiveUsersForRoom(room.ticket).length}</strong></div>
                    <div><span>Última actividad</span><strong>{formatTime(room.stats?.lastActivity)}</strong></div>
                  </div>

                  <div className="dev-room-actions">
                    <button className="song-action-btn play-now" onClick={() => onOpenRoom(room)} disabled={!isRoomUsable(room)}>
                      <DoorOpen size={15} /> Abrir
                    </button>
                    <button className="song-action-btn" onClick={() => syncFormFromRoom(room)}>
                      <Palette size={15} /> Editar
                    </button>
                    <button className="song-action-btn" onClick={() => renewPrivateRoom(room.id, 30)}>
                      <Repeat size={15} /> Renovar 30 días
                    </button>
                    <button className="song-action-btn" onClick={() => togglePrivateRoom(room.id)}>
                      <Zap size={15} /> {room.active ? "Desactivar" : "Activar"}
                    </button>
                    <button className="song-action-btn" onClick={() => copyTicket(room)}>
                      <Eye size={15} /> Copiar ticket
                    </button>
                    <button className="song-action-btn delete" onClick={() => deletePrivateRoom(room.id)}>
                      <Trash2 size={15} /> Eliminar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {devTab === "create" && (
          <div className="dev-create-layout">
            <section className="promo-editor-card dev-form-card">
              <div className="promo-editor-head">
                <div>
                  <span>{editingRoom ? "Editar local" : "Nuevo local"}</span>
                  <h3>{editingRoom ? editingRoom.businessName : "Crear sala privada"}</h3>
                  <p>Las 3 promos quedan disponibles para todos, pero empiezan vacías.</p>
                </div>
              </div>

              <div className="promo-form-grid">
                <label>
                  <span>Nombre del local</span>
                  <input value={form.businessName} onChange={(e) => setField("businessName", e.target.value)} placeholder="Karaoke50" />
                </label>

                <label>
                  <span>Ticket de sala</span>
                  <input value={form.ticket} onChange={(e) => setField("ticket", makeTicket(e.target.value))} placeholder="KARAOKE50" />
                </label>

                <label>
                  <span>PIN admin</span>
                  <input value={form.adminPin} onChange={(e) => setField("adminPin", e.target.value)} placeholder="5050" />
                </label>

                <label>
                  <span>Vence</span>
                  <input type="date" value={form.expiresAt} onChange={(e) => setField("expiresAt", e.target.value)} />
                </label>

                <label>
                  <span>Título TV</span>
                  <input value={form.publicTitle} onChange={(e) => setField("publicTitle", e.target.value)} placeholder="Karaoke Night" />
                </label>

                <label>
                  <span>Instagram</span>
                  <input value={form.instagram} onChange={(e) => setField("instagram", e.target.value)} placeholder="@tu_local" />
                </label>

                <label className="promo-form-wide">
                  <span>Slogan / mensaje TV</span>
                  <textarea value={form.slogan} onChange={(e) => setField("slogan", e.target.value)} rows="3" placeholder="Escanea el QR para pedir tu canción" />
                </label>

                <label className="promo-form-wide">
                  <span>Ubicación futura</span>
                  <input value={form.location} onChange={(e) => setField("location", e.target.value)} placeholder="Panamá, San Francisco, Calle 50..." />
                </label>
              </div>

              <div className="dev-logo-tools">
                <button className="promo-dropzone" type="button" onClick={() => logoInputRef.current?.click()}>
                  <div className="promo-drop-icon">
                    {form.logo ? <ImageIcon size={28} /> : <Upload size={28} />}
                  </div>
                  <strong>{form.logo ? "Logo cargado" : "Subir logo del local"}</strong>
                  <p>PNG o JPG. Se verá en admin, lobby y pantalla TV.</p>
                </button>

                <input ref={logoInputRef} className="promo-file-input" type="file" accept="image/*" onChange={(e) => readLogo(e.target.files?.[0])} />
              </div>

              <div className="dev-theme-tools">
                <div className="promo-tool-title">
                  <Palette size={18} /> Paleta de colores
                </div>

                <div className="dev-theme-list">
                  {themePresets.map((theme) => (
                    <button key={theme.id} type="button" className={form.themePreset === theme.id ? "active" : ""} onClick={() => applyThemePreset(theme.id)}>
                      <i style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})` }} />
                      {theme.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dev-form-actions">
                <button className="btn dark" onClick={resetForm}>Limpiar</button>
                <button className="btn primary" onClick={saveRoom}>{editingRoom ? "Guardar cambios" : "Crear sala privada"}</button>
              </div>
            </section>

            <section className="dev-preview-stack" style={{ "--primary": form.primary, "--primary2": form.secondary, "--bg": form.background }}>
              <DevTvPreview form={form} />
              <DevAdminPreview form={form} />
              <DevUserPreview form={form} />
            </section>
          </div>
        )}

        {devTab === "monitor" && (
          <div className="dev-monitor-grid">
            {privateRooms.map((room) => (
              <article className="dev-monitor-card" key={room.id}>
                <span className={`dev-status dev-status-${getRoomStatus(room)}`}>{getRoomStatusLabel(room)}</span>
                <h3>{room.businessName}</h3>
                <p>{room.location || "Ubicación pendiente"}</p>
                <div className="dev-room-metrics">
                  <div><span>Canciones</span><strong>{room.stats?.totalSongsPlayed || 0}</strong></div>
                  <div><span>Cantantes</span><strong>{room.stats?.totalSingers || 0}</strong></div>
                  <div><span>Sesiones</span><strong>{room.stats?.totalSessions || 0}</strong></div>
                  <div><span>Usuarios activos</span><strong>{getActiveUsersForRoom(room.ticket).length}</strong></div>
                </div>
              </article>
            ))}
          </div>
        )}

        {devTab === "catalog" && (
          <div className="youtube-catalog-panel">
            <div className="youtube-catalog-head">
              <div>
                <span>Catálogo YouTube</span>
                <h3>Canciones seleccionadas por usuarios</h3>
                <p>
                  Aquí solo aparecen los links que alguien pidió. Las búsquedas descartadas no llenan este catálogo.
                </p>
              </div>

              <button className="btn dark" onClick={clearVideoCatalog} disabled={videoCatalog.length === 0 && blockedYoutubeVideos.length === 0}>
                <Trash2 size={16} /> Limpiar canciones/cache
              </button>
            </div>

            <div className="local-video-dev-form">
              <div>
                <span>Biblioteca local</span>
                <h4>Agregar canción local o reemplazo de video bloqueado</h4>
                <p>Guarda una versión propia/local para que vuelva a aparecer en búsqueda y se reproduzca en TV sin depender de YouTube.</p>
              </div>

              <div className="local-video-grid">
                <input value={localVideoForm.title} onChange={(e) => setLocalVideoField("title", e.target.value)} placeholder="Título de la canción" />
                <input value={localVideoForm.channelTitle} onChange={(e) => setLocalVideoField("channelTitle", e.target.value)} placeholder="Artista / fuente" />
                <input value={localVideoForm.localVideoUrl} onChange={(e) => setLocalVideoField("localVideoUrl", e.target.value)} placeholder="Ruta local o URL del MP4: /videos/cancion.mp4" />
                <input value={localVideoForm.searchQuery} onChange={(e) => setLocalVideoField("searchQuery", e.target.value)} placeholder="Palabras de búsqueda: vivir mi vida marc anthony" />
                <input value={localVideoForm.originalYoutubeId} onChange={(e) => setLocalVideoField("originalYoutubeId", e.target.value)} placeholder="YouTube ID bloqueado opcional" />
                <input value={localVideoForm.thumbnail} onChange={(e) => setLocalVideoField("thumbnail", e.target.value)} placeholder="Miniatura opcional" />
              </div>

              <button className="btn primary" onClick={saveLocalVideoFromDev} disabled={!localVideoForm.title.trim() || !localVideoForm.localVideoUrl.trim()}>
                <Plus size={16} /> Agregar a biblioteca local
              </button>
            </div>

            {blockedYoutubeVideos.length > 0 && (
              <div className="blocked-video-dev-list">
                <span>Videos bloqueados detectados</span>
                {blockedYoutubeVideos.slice(0, 6).map((video) => (
                  <button
                    className="blocked-video-chip"
                    key={video.youtubeId}
                    onClick={() => {
                      setLocalVideoForm((current) => ({
                        ...current,
                        title: video.title || "",
                        channelTitle: video.channelTitle || "Biblioteca local",
                        searchQuery: video.title || "",
                        originalYoutubeId: video.youtubeId || "",
                      }));
                    }}
                  >
                    {video.resolvedWithLocal ? "Resuelto" : "Pendiente"} · {video.title}
                  </button>
                ))}
              </div>
            )}

            {videoCatalog.length === 0 && (
              <div className="empty-admin">
                Todavía no hay canciones pedidas. Cuando un usuario elija “Pedir”, aparecerá aquí el link.
              </div>
            )}

            {videoCatalog.length > 0 && (
              <div className="youtube-catalog-list">
                {videoCatalog.map((video) => (
                  <article className="youtube-catalog-card" key={video.youtubeId}>
                    <div className="youtube-thumb">
                      {video.thumbnail ? <img src={video.thumbnail} alt={video.title} /> : <Music size={24} />}
                    </div>

                    <div>
                      <h4>{video.title}</h4>
                      <p>{video.channelTitle} · {video.source || "cache"}</p>
                      <small>Pedidos: {video.requestedCount || 0} · Último uso: {formatTime(video.lastUsedAt)}</small>
                      {video.source === "local" && <small className="local-video-label">Disponible localmente</small>}
                      {video.blocked && <small className="blocked-video-label">Bloqueada: no se pudo reproducir en TV</small>}
                    </div>

                    <button className="song-action-btn play-now" onClick={() => copyYoutubeUrl(video)}>
                      <Eye size={15} /> Copiar URL
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function DevTvPreview({ form }) {
  return (
    <div className="dev-preview-card dev-preview-tv">
      <div className="dev-preview-top">
        <span>Vista TV</span>
        <Tv size={16} />
      </div>
      <div className="dev-preview-logo">
        {form.logo ? <img src={form.logo} alt={form.businessName} /> : <Mic2 size={34} />}
      </div>
      <h3>{form.publicTitle || "Karaoke Night"}</h3>
      <p>{form.slogan || "Escanea el QR para pedir tu canción"}</p>
      <div className="dev-preview-qr">QR</div>
      <strong>{makeTicket(form.ticket || form.businessName) || "TICKET"}</strong>
    </div>
  );
}

function DevAdminPreview({ form }) {
  return (
    <div className="dev-preview-card dev-preview-admin">
      <div className="dev-preview-top">
        <span>Vista Admin</span>
        <Crown size={16} />
      </div>
      <h3>{form.businessName || "Tu local"} Admin</h3>
      <p>Cola actual · Historial · Promo</p>
      <div className="dev-preview-buttons">
        <span>Pausar corte</span>
        <span>Siguiente</span>
      </div>
    </div>
  );
}

function DevUserPreview({ form }) {
  return (
    <div className="dev-preview-card dev-preview-user">
      <div className="dev-preview-top">
        <span>Vista Invitado</span>
        <Music size={16} />
      </div>
      <h3>{form.businessName || "Tu local"}</h3>
      <p>Elige avatar, busca karaoke y pide tu canción.</p>
    </div>
  );
}

function HomeScreen({ onCreate, roomCode, setRoomCode, onJoin, onDev, onPrivateAdmin }) {
  return (
    <main className="home home-clean">
      <section className="hero-card hero-card-clean">
        <div className="brand brand-home">
          <div className="brand-icon">
            <Mic2 size={34} />
          </div>

          <div className="brand-copy">
            <h1>SPACEOKE</h1>
            <p>Karaoke para eventos con salas por QR</p>
          </div>
        </div>

        <div className="hero-content hero-content-clean">
          <h2>Crea una sala y comparte el QR.</h2>

          <p>
            Tus invitados entran desde el celular, eligen nombre y avatar,
            buscan su karaoke y tú controlas toda la cola.
          </p>
        </div>

        <div className="home-actions home-actions-clean">
          <button className="btn primary btn-main-action" onClick={onCreate}>
            <Plus size={20} />
            Crear sala
          </button>

          <div className="join-area">
            <div className="join-label">o unirse a una sala existente</div>

            <div className="join-box join-box-clean">
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="PIN o ticket de sala"
                maxLength="14"
              />

              <button className="btn dark" onClick={onJoin}>
                <DoorOpen size={18} />
                Unirse
              </button>
            </div>
          </div>
        </div>

        <button className="dev-entry-btn hidden-access" onClick={onDev} aria-hidden="true" tabIndex="-1">
          <Crown size={16} />
          Dev Panel
        </button>
      </section>
    </main>
  );
}

function LobbyScreen({ roomCode, brandRoom, themeStyle, onAdmin, onTv, onBack }) {
  const roomUrl = `${window.location.origin}/sala/${roomCode}`;

  return (
    <main className="lobby" style={themeStyle}>
      <button className="back-btn" onClick={onBack}>
        <LogOut size={18} />
        Volver
      </button>

      <section className="lobby-card">
        <div className="room-badge">{brandRoom ? "SALA PRIVADA" : "SALA CREADA"}</div>

        {brandRoom?.logo && <img className="lobby-brand-logo" src={brandRoom.logo} alt={brandRoom.businessName} />}

        <h2>{brandRoom?.businessName || "Código de sala"}</h2>

        <div className="big-code">{roomCode}</div>

        <div className="qr-box">
          <QRCodeCanvas value={roomUrl} size={190} />
        </div>

        <p className="muted">
          {brandRoom?.slogan || "Muestra este QR en la TV para que los invitados entren desde su celular."}
        </p>

        <div className="lobby-actions">
          <button className="btn primary" onClick={onAdmin}>
            <Crown size={20} />
            Entrar como admin
          </button>

          <button className="btn dark" onClick={onTv}>
            <Tv size={20} />
            Abrir vista TV
          </button>
        </div>
      </section>
    </main>
  );
}

function AvatarScreen({
  brandName,
  brandLogo,
  brandRoom,
  themeStyle,
  playerName,
  setPlayerName,
  selectedAvatar,
  setSelectedAvatar,
  onContinue,
  onBack,
}) {
  const cleanName = playerName.trim();

  return (
    <main className="avatar-screen avatar-screen-clean" style={themeStyle}>
      <button className="back-btn" onClick={onBack}>
        <LogOut size={18} />
        Salir
      </button>

      <section className="section-card avatar-card-clean">
        {brandRoom && (
          <div className="avatar-local-brand">
            {brandLogo ? (
              <img src={brandLogo} alt={brandName} />
            ) : (
              <div className="avatar-local-logo">
                <Mic2 size={22} />
              </div>
            )}

            <div>
              <span>Entrando a</span>
              <strong>{brandName}</strong>
              <small>{brandRoom.slogan}</small>
            </div>
          </div>
        )}

        <div className="avatar-title-block">
          <h2>Configura tu perfil</h2>

          <p className="muted">
            Escribe tu nombre y elige un avatar para aparecer en la cola.
          </p>
        </div>

        <div className="name-box avatar-name-box">
          <label>Tu nombre</label>

          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Ejemplo: Roly, José, Deisy"
            maxLength="18"
          />
        </div>

        <div className="avatar-select-row">
          {avatars.map((avatar) => (
            <button
              key={avatar.id}
              type="button"
              className={`avatar-icon-option ${
                selectedAvatar?.id === avatar.id ? "active" : ""
              }`}
              onClick={() => setSelectedAvatar(avatar)}
              title={avatar.name}
            >
              <span>{avatar.icon}</span>
            </button>
          ))}
        </div>

        <div className="avatar-preview-box">
          <div className="avatar-preview-icon">
            {selectedAvatar?.icon || "🎤"}
          </div>

          <div>
            <span>Así aparecerás</span>

            <strong>
              {selectedAvatar && cleanName
                ? `${selectedAvatar.name} ${cleanName}`
                : "Elige nombre y avatar"}
            </strong>
          </div>
        </div>

        <button className="btn primary full avatar-continue-btn" onClick={onContinue}>
          Entrar a la sala
        </button>
      </section>
    </main>
  );
}

function MobileScreen({
  roomCode,
  brandRoom,
  brandName,
  brandLogo,
  themeStyle,
  selectedAvatar,
  playerName,
  searchText,
  setSearchText,
  addDemoSong,
  searchKaraokeSongs,
  requestSongFromVideo,
  youtubeSearchResults,
  youtubeSearchState,
  queue,
  myActiveTurn,
  myLatestVideoError,
  hasActiveTurn,
  cancelMyTurn,
  onBack,
}) {
  const filteredSearch = searchText.trim()
    ? searchText.toLowerCase().includes("karaoke")
      ? searchText
      : `${searchText} karaoke`
    : "";

  const displayName = selectedAvatar
    ? `${selectedAvatar.name} ${playerName.trim()}`
    : "Invitado";

  const myTurnPosition = myActiveTurn
    ? queue.findIndex((song) => song.id === myActiveTurn.id) + 1
    : null;

  return (
    <main
      className={`mobile-view ${brandRoom ? "private-mobile-view" : ""}`}
      style={themeStyle}
    >
      <header className="mobile-header mobile-header-premium">
        <button className="icon-btn mobile-back-btn" onClick={onBack} aria-label="Salir">
          <LogOut size={18} />
        </button>

        <div className="mobile-local-mark">
          {brandLogo ? (
            <img src={brandLogo} alt={brandName} />
          ) : (
            <div className="mobile-local-mark-fallback">
              <Mic2 size={23} />
            </div>
          )}
        </div>

        <div className="mobile-header-copy">
          <span>Sala {roomCode || "4821"}</span>
          <h2>{brandName || "MK"}</h2>

          <p>
            <span className="mobile-player-avatar">{selectedAvatar?.icon || "🎤"}</span>
            <strong className="gold-user-name">{displayName}</strong>
          </p>
        </div>
      </header>

      <section className="search-panel">
        <div className="panel-title">
          <Music size={22} />

          <h3>Buscar canción</h3>
        </div>

        <p className="muted">
          La búsqueda se prepara para enviar a YouTube como karaoke.
        </p>

        {myLatestVideoError && !hasActiveTurn && (
          <div className="video-error-user-notice">
            <strong>Disculpa, esa versión falló en TV.</strong>
            <p>{myLatestVideoError.title}</p>
            <small>Busca otra versión. Tu próximo pedido subirá arriba de la cola.</small>
          </div>
        )}

        {myActiveTurn && (
          <div className="my-turn-box">
            <strong>
              Tu turno está activo
              {myTurnPosition ? ` · Posición #${myTurnPosition}` : ""}
            </strong>

            <p>
              {myActiveTurn.avatar} {myActiveTurn.title}
            </p>

            <span className={`status-pill status-${myActiveTurn.status}`}>
              {getStatusLabel(myActiveTurn.status)}
            </span>

            <button className="btn dark full cancel-turn-btn" onClick={cancelMyTurn}>
              <Trash2 size={18} />
              Cancelar mi turno
            </button>
          </div>
        )}

        <div className="search-box">
          <Search size={20} />

          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
              }
            }}
            placeholder="Ejemplo: Perfect Ed Sheeran"
            disabled={hasActiveTurn}
          />
        </div>

        {filteredSearch && !hasActiveTurn && (
          <div className="karaoke-lock">
            <Radio size={18} />
            Se buscará como: <strong>{filteredSearch}</strong>
          </div>
        )}

        {hasActiveTurn && (
          <div className="karaoke-lock">
            <Radio size={18} />
            Ya tienes una canción activa. No puedes pedir otra todavía.
          </div>
        )}

        <button
          className="btn primary full"
          onClick={searchKaraokeSongs || addDemoSong}
          disabled={hasActiveTurn || youtubeSearchState.loading}
        >
          <Search size={20} />
          {youtubeSearchState.loading
            ? "Buscando..."
            : hasActiveTurn
              ? "Ya tienes turno activo"
              : "Buscar karaokes"}
        </button>

        {youtubeSearchState.message && (
          <div className={`youtube-search-message ${youtubeSearchState.fromCache ? "from-cache" : ""}`}>
            {youtubeSearchState.message}
          </div>
        )}

        {youtubeSearchResults.length > 0 && !hasActiveTurn && (
          <div className="youtube-result-list">
            {youtubeSearchResults.map((video) => (
              <article className="youtube-result-card" key={video.youtubeId}>
                <div className="youtube-result-thumb">
                  {video.thumbnail ? <img src={video.thumbnail} alt={video.title} /> : <Music size={22} />}
                </div>

                <div>
                  <strong>{video.title}</strong>
                  <p>{video.channelTitle}</p>
                  <small>{video.source === "demo-cache" ? "Demo local" : video.source || "YouTube"}</small>
                </div>

                <button className="song-action-btn play-now" onClick={() => requestSongFromVideo(video)}>
                  <Plus size={15} /> Pedir
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="queue-preview">
        <h3>Cola actual</h3>

        {queue.length === 0 && (
          <p className="muted">Todavía no hay canciones en cola.</p>
        )}

        {queue.map((song, index) => (
          <div className="mini-song" key={`${song.id}-${song.repeatKey || 0}`}>
            <div className="position">{index + 1}</div>

            <div className="avatar-mini">{song.avatar}</div>

            <div>
              <strong>{song.title}</strong>

              <p>
                <span className="gold-user-name">{song.user}</span> · {song.artist}
              </p>

              <span className={`status-pill status-${song.status}`}>
                {getStatusLabel(song.status)}
              </span>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

function AdminScreen({
  roomCode,
  brandRoom,
  themeStyle,
  brandName,
  brandLogo,
  queue,
  history,
  stats,
  adminTab,
  setAdminTab,
  currentSong,
  nextSong,
  deleteSong,
  repeatCurrentSong,
  moveSongUp,
  playSongNow,
  markCurrentAsNoShow,
  reinsertFromHistory,
  karaokePaused,
  setKaraokePaused,
  promoSlides,
  setPromoSlides,
  activePromoIndex,
  setActivePromoIndex,
  onBack,
}) {
  return (
    <main className="admin-view" style={themeStyle}>
      <aside className="admin-sidebar">
        <div className="brand mini">
          <div className="brand-icon">
            {brandLogo ? <img className="brand-logo-img" src={brandLogo} alt={brandName} /> : <Crown size={26} />}
          </div>

          <div>
            <h1>{brandName || "MK"} Admin</h1>

            <p>Sala {roomCode}</p>
          </div>
        </div>

        <button className="btn dark full" onClick={onBack}>
          <LogOut size={18} />
          Volver al QR
        </button>
      </aside>

      <section className="admin-main">
        <div className="admin-top">
          <div>
            <h2>Panel del admin</h2>

            <p>{brandRoom ? `Control privado de ${brandRoom.businessName}` : "Controla la cola, el historial, ausentes, promos y cortes."}</p>
          </div>

          <div className="admin-main-actions admin-control-actions">
            <button
              className={`btn admin-toggle-btn ${karaokePaused ? "primary" : "pause-cut"}`}
              onClick={() => setKaraokePaused((current) => !current)}
              disabled={!currentSong}
            >
              {karaokePaused ? <Play size={22} /> : <Pause size={22} />}
              {karaokePaused ? "Reanudar" : "Pausar corte"}
            </button>

            <button
              className="btn dark"
              onClick={repeatCurrentSong}
              disabled={!currentSong || karaokePaused}
            >
              <Repeat size={20} />
              Repetir actual
            </button>

            <button
              className="btn dark danger-soft"
              onClick={markCurrentAsNoShow}
              disabled={!currentSong || karaokePaused}
            >
              <LogOut size={20} />
              No apareció
            </button>

            <button
              className="btn primary"
              onClick={nextSong}
              disabled={!currentSong || karaokePaused}
            >
              <SkipForward size={20} />
              Siguiente
            </button>
          </div>
        </div>

        <div className="stats-grid">
          <div>
            <span>Activas</span>
            <strong>{stats.active}</strong>
          </div>

          <div>
            <span>Cantadas</span>
            <strong>{stats.done}</strong>
          </div>

          <div>
            <span>Ausentes</span>
            <strong>{stats.noShow}</strong>
          </div>

          <div>
            <span>Cantantes</span>
            <strong>{stats.singers}</strong>
          </div>

          <div>
            <span>Usuarios</span>
            <strong>{stats.users}</strong>
          </div>
        </div>

        <div className={`now-playing ${karaokePaused ? "now-playing-paused" : ""}`}>
          <div className="glow-orb">
            {karaokePaused ? <Pause size={34} /> : <Play size={34} />}
          </div>

          <div>
            <span>{karaokePaused ? "Karaoke pausado" : "Sonando ahora"}</span>

            <h3>
              {karaokePaused
                ? "Corte activo · la cola se mantiene"
                : currentSong?.title || "No hay canción activa"}
            </h3>

            <p>
              {currentSong ? (
                <>
                  <span className="gold-user-name">{currentSong.user}</span> · {currentSong.artist}
                </>
              ) : (
                "Esperando solicitudes"
              )}
            </p>
          </div>
        </div>

        <div className="admin-tabs">
          <button
            className={adminTab === "queue" ? "active" : ""}
            onClick={() => setAdminTab("queue")}
          >
            Cola actual
          </button>

          <button
            className={adminTab === "history" ? "active" : ""}
            onClick={() => setAdminTab("history")}
          >
            Historial
          </button>

          <button
            className={adminTab === "promo" ? "active" : ""}
            onClick={() => setAdminTab("promo")}
          >
            Promo
          </button>
        </div>

        {adminTab === "queue" && (
          <div className="admin-grid">
            {queue.length === 0 && (
              <div className="empty-admin">No hay canciones en la cola.</div>
            )}

            {queue.map((song, index) => (
              <article
                className={`song-card ${
                  currentSong?.id === song.id ? "song-card-active" : ""
                }`}
                key={`${song.id}-${song.repeatKey || 0}`}
              >
                <div className="song-avatar">{song.avatar}</div>

                <div className="song-info">
                  <span>
                    {song.status === "playing"
                      ? "Sonando ahora"
                      : `Turno #${index + 1}`}
                  </span>

                  <h3>{song.title}</h3>

                  <p>{song.artist}</p>

                  <div className="song-meta">
                    <small className="gold-user-name">{song.user}</small>
                    <small>{song.duration}</small>
                    <small>Pidió: {formatTime(song.requestedAt)}</small>
                  </div>

                  <span className={`status-pill status-${song.status}`}>
                    {getStatusLabel(song.status)}
                  </span>

                  <div className="song-actions">
                    <button
                      className="song-action-btn play-now"
                      onClick={() => playSongNow(song.id)}
                      disabled={song.status === "playing" || karaokePaused}
                    >
                      <Zap size={15} />
                      Tocar ahora
                    </button>

                    <button
                      className="song-action-btn"
                      onClick={() => moveSongUp(song.id)}
                      disabled={song.status === "playing" || karaokePaused}
                    >
                      <ArrowUp size={15} />
                      Adelantar
                    </button>

                    <button
                      className="song-action-btn delete"
                      onClick={() => deleteSong(song.id)}
                    >
                      <Trash2 size={15} />
                      Eliminar
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {adminTab === "history" && (
          <div className="history-grid">
            {history.length === 0 && (
              <div className="empty-admin">Todavía no hay historial.</div>
            )}

            {history.map((song) => (
              <article className="history-card" key={`${song.id}-${song.status}`}>
                <div className="song-avatar">{song.avatar}</div>

                <div className="song-info">
                  <span>{getStatusLabel(song.status)}</span>

                  <h3>{song.title}</h3>

                  <p>{song.artist}</p>

                  <div className="song-meta">
                    <small className="gold-user-name">{song.user}</small>
                    <small>Inicio: {formatTime(song.startedAt)}</small>
                    <small>Fin: {formatTime(song.endedAt)}</small>
                    <small>Reintentos: {song.retryCount || 0}</small>
                  </div>

                  {(song.status === "no_show" || song.status === "skipped") && (
                    <button
                      className="song-action-btn play-now"
                      onClick={() => reinsertFromHistory(song.id)}
                    >
                      <Repeat size={15} />
                      Reinsertar en cola
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {adminTab === "promo" && (
          <PromoPanel
            promoSlides={promoSlides}
            setPromoSlides={setPromoSlides}
            activePromoIndex={activePromoIndex}
            setActivePromoIndex={setActivePromoIndex}
            roomCode={roomCode}
          />
        )}
      </section>
    </main>
  );
}


function PromoPanel({
  promoSlides,
  setPromoSlides,
  activePromoIndex,
  setActivePromoIndex,
  roomCode,
}) {
  const fileInputRef = useRef(null);
  const safeIndex = Math.min(activePromoIndex, promoSlides.length - 1);
  const activePromo = promoSlides[safeIndex] || promoSlides[0];

  const updatePromo = (field, value) => {
    setPromoSlides((current) =>
      current.map((promo, index) =>
        index === safeIndex ? { ...promo, [field]: value } : promo
      )
    );
  };

  const readPromoImage = (file) => {
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();

    reader.onload = () => {
      setPromoSlides((current) =>
        current.map((promo, index) =>
          index === safeIndex
            ? {
                ...promo,
                image: reader.result,
                imageName: file.name,
              }
            : promo
        )
      );
    };

    reader.readAsDataURL(file);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    readPromoImage(event.dataTransfer.files?.[0]);
  };

  const handleFileChange = (event) => {
    readPromoImage(event.target.files?.[0]);
    event.target.value = "";
  };

  const removeImage = () => {
    setPromoSlides((current) =>
      current.map((promo, index) =>
        index === safeIndex
          ? {
              ...promo,
              image: "",
              imageName: "",
            }
          : promo
      )
    );
  };

  return (
    <div className="promo-admin-layout">
      <section className="promo-editor-card">
        <div className="promo-editor-head">
          <div>
            <span>Modo pantalla del local</span>
            <h3>Promociones en TV</h3>
            <p>
              Puedes preparar hasta 3 promos. La TV las alternará con el QR
              manteniendo el diseño premium anterior.
            </p>
          </div>

          <label className="promo-switch">
            <input
              type="checkbox"
              checked={activePromo.enabled}
              onChange={(event) => updatePromo("enabled", event.target.checked)}
            />
            <span>{activePromo.enabled ? "Activa" : "Pausada"}</span>
          </label>
        </div>

        <div className="promo-slide-tabs">
          {promoSlides.map((promo, index) => (
            <button
              key={promo.id}
              type="button"
              className={index === safeIndex ? "active" : ""}
              onClick={() => setActivePromoIndex(index)}
            >
              Promo {index + 1}
              <small>{promo.enabled ? "Activa" : "Pausada"}</small>
            </button>
          ))}
        </div>

        <button
          className="promo-dropzone"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="promo-drop-icon">
            {activePromo.image ? <ImageIcon size={28} /> : <Upload size={28} />}
          </div>

          <strong>Arrastra una imagen o busca en tu dispositivo</strong>
          <p>
            {activePromo.imageName ||
              "Ideal: flyer, historia de Instagram, promo de bebida o logo del local."}
          </p>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="promo-file-input"
          onChange={handleFileChange}
        />

        {activePromo.image && (
          <button className="promo-remove-image" type="button" onClick={removeImage}>
            <Trash2 size={16} />
            Quitar imagen
          </button>
        )}

        <div className="promo-form-grid">
          <label>
            <span>Título principal</span>
            <input
              value={activePromo.title}
              onChange={(event) => updatePromo("title", event.target.value)}
              placeholder="Happy Hour"
            />
          </label>

          <label>
            <span>Subtítulo</span>
            <input
              value={activePromo.subtitle}
              onChange={(event) => updatePromo("subtitle", event.target.value)}
              placeholder="Hasta las 9:00 PM"
            />
          </label>

          <label className="promo-form-wide">
            <span>Mensaje corto</span>
            <textarea
              value={activePromo.description}
              onChange={(event) => updatePromo("description", event.target.value)}
              placeholder="Escanea para cantar y pregunta por la promoción del día."
              rows="3"
            />
          </label>

          <label>
            <span>Instagram / redes</span>
            <input
              value={activePromo.instagram}
              onChange={(event) => updatePromo("instagram", event.target.value)}
              placeholder="@tu_local"
            />
          </label>

          <label>
            <span>Duración por slide</span>
            <select
              value={activePromo.duration}
              onChange={(event) => updatePromo("duration", Number(event.target.value))}
            >
              <option value={5}>5 segundos</option>
              <option value={7}>7 segundos</option>
              <option value={10}>10 segundos</option>
              <option value={12}>12 segundos</option>
            </select>
          </label>
        </div>

        <div className="promo-font-tools">
          <div className="promo-tool-title">
            <Type size={18} />
            Tipografía en TV
          </div>

          <div className="promo-font-list">
            {promoFontOptions.map((font) => (
              <button
                key={font.id}
                type="button"
                className={activePromo.font === font.id ? "active" : ""}
                onClick={() => updatePromo("font", font.id)}
              >
                {font.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={`promo-preview-card promo-font-${activePromo.font}`}>
        <div className="promo-preview-top">
          <span>Vista previa TV</span>
          <Eye size={18} />
        </div>

        {activePromo.image ? (
          <img src={activePromo.image} alt="Promoción" className="promo-preview-image" />
        ) : (
          <div className="promo-preview-placeholder">
            <Palette size={38} />
            <span>Sin imagen</span>
          </div>
        )}

        <div className="promo-preview-copy">
          <span>Promo {safeIndex + 1}</span>
          <h3>{activePromo.title || "Tu promoción"}</h3>
          <h4>{activePromo.subtitle || "Subtítulo de la promo"}</h4>
          <p>{activePromo.description || "Aquí se verá el mensaje que quieres mostrar en la TV."}</p>
          <strong>{activePromo.instagram || "@tu_local"}</strong>
        </div>

        <div className="promo-preview-qr">
          <QRCodeCanvas value={`https://mk-karaoke.app/sala/${roomCode}`} size={82} />
          <span>Escanea para cantar</span>
        </div>
      </section>
    </div>
  );
}

function PromoTvSlide({ promoSettings, roomUrl, roomCode }) {
  return (
    <div className={`tv-promo-slide promo-font-${promoSettings.font}`}>
      <div className="tv-promo-content">
        <div className="tv-promo-copy">
          <span>Promoción del local</span>
          <h1>{promoSettings.title || "Promoción especial"}</h1>
          <h2>{promoSettings.subtitle || "Disponible por tiempo limitado"}</h2>
          <p>{promoSettings.description || "Escanea para cantar y disfruta la promoción de la noche."}</p>

          {promoSettings.instagram && (
            <strong>Síguenos: {promoSettings.instagram}</strong>
          )}
        </div>

        <div className="tv-promo-image-wrap">
          {promoSettings.image ? (
            <img src={promoSettings.image} alt="Promoción del local" />
          ) : (
            <div className="tv-promo-placeholder">
              <ImageIcon size={46} />
              <strong>Promo disponible</strong>
              <span>Aquí aparecerá la promoción del local</span>
            </div>
          )}
        </div>
      </div>

      <div className="tv-promo-qr-card">
        <QRCodeCanvas value={roomUrl} size={150} />
        <span>Escanea para cantar</span>
        <strong>{roomCode}</strong>
      </div>
    </div>
  );
}


function LocalVideoPlayer({ song, shouldPlay, tvActivated, onReadyChange, onError }) {
  const videoRef = useRef(null);

  useEffect(() => {
    onReadyChange(Boolean(song?.localVideoUrl));
  }, [song?.localVideoUrl, song?.id, song?.repeatKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !tvActivated) return;

    if (shouldPlay) {
      video.play().catch(() => {
        onError("No se pudo iniciar el video local. Revisa la ruta del archivo.");
      });
    } else {
      video.pause();
    }
  }, [shouldPlay, tvActivated, song?.localVideoUrl, song?.id, song?.repeatKey]);

  return (
    <div className="youtube-video-frame local-video-frame">
      <video
        ref={videoRef}
        src={song.localVideoUrl}
        controls
        playsInline
        preload="auto"
        onCanPlay={() => onReadyChange(true)}
        onError={() => onError("No se pudo cargar el video local. Revisa que el archivo exista.")}
      />
    </div>
  );
}

function loadYouTubeIframeApi() {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === "function") {
        previousReady();
      }
      resolve(window.YT);
    };

    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("No se pudo cargar YouTube Player."));
    document.body.appendChild(script);
  });
}

function YouTubeSmartPlayer({ song, shouldPlay, shouldWarmup, tvActivated, onReadyChange, onError }) {
  const containerIdRef = useRef(
    `yt-player-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const playerRef = useRef(null);
  const mountedRef = useRef(true);
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    setPlayerReady(false);
    onReadyChange(false);
    onError("");

    if (!song?.youtubeId) return undefined;

    let cancelled = false;

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !mountedRef.current) return;

        if (playerRef.current?.destroy) {
          playerRef.current.destroy();
        }

        playerRef.current = new YT.Player(containerIdRef.current, {
          videoId: song.youtubeId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (!mountedRef.current) return;

              try {
                event.target.setPlaybackQuality?.("hd1080");
                event.target.cueVideoById({ videoId: song.youtubeId, suggestedQuality: "hd1080" });
                event.target.setVolume(100);
              } catch (error) {
                console.warn("No se pudo preparar el video", error);
              }

              setPlayerReady(true);
              onReadyChange(true);
            },
            onError: () => {
              if (!mountedRef.current) return;
              onError("YouTube no pudo cargar este video. Prueba con otra versión o pasa al siguiente turno.");
            },
          },
        });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        onError("No se pudo cargar el reproductor de YouTube.");
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      onReadyChange(false);
      try {
        playerRef.current?.destroy?.();
      } catch (error) {
        console.warn("No se pudo destruir el reproductor", error);
      }
      playerRef.current = null;
    };
  }, [song?.youtubeId, song?.id, song?.repeatKey]);

  useEffect(() => {
    if (!playerRef.current || !tvActivated || !playerReady) return;

    try {
      if (shouldPlay) {
        playerRef.current.unMute?.();
        playerRef.current.setVolume?.(100);
        playerRef.current.setPlaybackQuality?.("hd1080");
        playerRef.current.playVideo();
      } else if (shouldWarmup) {
        // Precarga real durante la cuenta 4, 3, 2, 1.
        // El video ya se mueve detrás de la intro, pero queda silenciado hasta que termina el conteo.
        playerRef.current.mute?.();
        playerRef.current.setVolume?.(0);
        playerRef.current.setPlaybackQuality?.("hd1080");
        playerRef.current.playVideo();
      } else {
        playerRef.current.pauseVideo?.();
      }
    } catch (error) {
      console.warn("No se pudo controlar YouTube", error);
    }
  }, [shouldPlay, shouldWarmup, tvActivated, playerReady, song?.youtubeId, song?.id, song?.repeatKey]);

  return (
    <div className="youtube-video-frame youtube-smart-frame">
      <div id={containerIdRef.current} className="youtube-player-node" />
    </div>
  );
}

function TvScreen({ roomCode, brandRoom, themeStyle, brandName, brandLogo, currentSong, promoSlides, karaokePaused, onVideoPlaybackError, onBack }) {
  const roomUrl = `${window.location.origin}/sala/${roomCode}`;
  const activePromos = (promoSlides || []).filter((promo) => promo.enabled);
  const [showTvOverlay, setShowTvOverlay] = useState(true);
  const [showIntro, setShowIntro] = useState(Boolean(currentSong && !karaokePaused));
  const [countdown, setCountdown] = useState(INTRO_SECONDS);
  const [idleSlideIndex, setIdleSlideIndex] = useState(0);
  const [tvActivated, setTvActivated] = useState(false);
  const [youtubeReady, setYoutubeReady] = useState(false);
  const [youtubeError, setYoutubeError] = useState("");
  const hideTimerRef = useRef(null);
  const reportedYoutubeErrorRef = useRef(null);

  const playingEnabled = Boolean(currentSong && !karaokePaused);
  const hasLocalVideo = Boolean(currentSong?.localVideoUrl);
  const hasYoutubeVideo = Boolean(currentSong?.youtubeId && !hasLocalVideo);
  const hasPlayableVideo = hasLocalVideo || hasYoutubeVideo;
  const shouldPlayMedia = Boolean(playingEnabled && hasPlayableVideo && !showIntro && !youtubeError);
  const currentIdleItem =
    idleSlideIndex === 0
      ? { type: "qr" }
      : { type: "promo", promo: activePromos[(idleSlideIndex - 1) % activePromos.length] };

  useEffect(() => {
    document.body.classList.add("tv-mode");

    return () => {
      document.body.classList.remove("tv-mode");
    };
  }, []);

  const resetTvOverlay = () => {
    setShowTvOverlay(true);

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }

    hideTimerRef.current = setTimeout(() => {
      setShowTvOverlay(false);
    }, 2800);
  };

  const activateTvPlayback = () => {
    setTvActivated(true);
    resetTvOverlay();
  };

  useEffect(() => {
    resetTvOverlay();

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [currentSong, karaokePaused]);

  useEffect(() => {
    setYoutubeReady(false);
    setYoutubeError("");
    reportedYoutubeErrorRef.current = null;
  }, [currentSong?.id, currentSong?.repeatKey, currentSong?.youtubeId, currentSong?.localVideoUrl]);

  useEffect(() => {
    if (!playingEnabled) {
      setShowIntro(false);
      setCountdown(INTRO_SECONDS);
      return;
    }

    setShowIntro(true);
    setCountdown(INTRO_SECONDS);

    const interval = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          clearInterval(interval);
          setShowIntro(false);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [playingEnabled, currentSong?.id, currentSong?.repeatKey]);

  useEffect(() => {
    if (playingEnabled || activePromos.length === 0) {
      setIdleSlideIndex(0);
      return;
    }

    setIdleSlideIndex(0);

    const getCurrentDuration = () => {
      if (idleSlideIndex === 0) return 7;
      return activePromos[(idleSlideIndex - 1) % activePromos.length]?.duration || 7;
    };

    const interval = setInterval(() => {
      setIdleSlideIndex((current) => {
        const totalSlides = activePromos.length + 1;
        return (current + 1) % totalSlides;
      });
    }, getCurrentDuration() * 1000);

    return () => clearInterval(interval);
  }, [playingEnabled, activePromos.length, promoSlides]);

  const handleYoutubeError = (message) => {
    setYoutubeError(message);

    if (!message || !currentSong?.youtubeId) return;
    if (reportedYoutubeErrorRef.current === currentSong.youtubeId) return;

    reportedYoutubeErrorRef.current = currentSong.youtubeId;
    onVideoPlaybackError?.(currentSong, message);
  };

  return (
    <main
      className="tv-view tv-view-full tv-premium"
      style={themeStyle}
      onMouseMove={resetTvOverlay}
      onMouseDown={resetTvOverlay}
      onClick={resetTvOverlay}
      onTouchStart={resetTvOverlay}
      onTouchMove={resetTvOverlay}
    >
      <div className="tv-ambient" />

      {!tvActivated && (
        <div className="tv-activation-layer">
          <div className="tv-activation-card">
            <div className="mk-modal-icon">
              <Play size={30} />
            </div>
            <h2>Activar TV</h2>
            <p>
              Toca una vez para permitir que SPACEOKE reproduzca los videos automáticamente durante el evento.
            </p>
            <button className="btn primary" onClick={activateTvPlayback}>
              <Play size={18} />
              Activar reproducción
            </button>
          </div>
        </div>
      )}

      <button
        className={`tv-exit tv-overlay-ui ${
          showTvOverlay ? "tv-ui-visible" : "tv-ui-hidden"
        }`}
        onClick={onBack}
      >
        Volver al QR
      </button>

      <section className="tv-stage tv-stage-full">
        {playingEnabled ? (
          <>
            <div
              className="fake-video fake-video-full premium-video youtube-preload-stage"
              key={`${currentSong.id}-${currentSong.repeatKey || 0}`}
            >
              {hasPlayableVideo ? (
                <>
                  {hasLocalVideo ? (
                    <LocalVideoPlayer
                      song={currentSong}
                      shouldPlay={shouldPlayMedia}
                      tvActivated={tvActivated}
                      onReadyChange={setYoutubeReady}
                      onError={handleYoutubeError}
                    />
                  ) : (
                    <YouTubeSmartPlayer
                      song={currentSong}
                      shouldPlay={shouldPlayMedia}
                      shouldWarmup={Boolean(playingEnabled && showIntro && hasYoutubeVideo && !youtubeError)}
                      tvActivated={tvActivated}
                      onReadyChange={setYoutubeReady}
                      onError={handleYoutubeError}
                    />
                  )}

                  {!showIntro && !youtubeReady && !youtubeError && (
                    <div className="video-loading-overlay">
                      <div className="video-loader-ring" />
                      <h2>Preparando video</h2>
                      <p>El karaoke ya está cargando. Espera un momento.</p>
                    </div>
                  )}

                  {!showIntro && youtubeError && (
                    <div className="video-loading-overlay video-error-overlay">
                      <Clapperboard size={64} />
                      <h2>No se pudo reproducir</h2>
                      <p>{youtubeError}</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="video-center">
                    <Clapperboard size={78} />

                    <h2>{currentSong.title}</h2>

                    <p>{currentSong.artist}</p>
                  </div>

                  <div className="lyrics">
                    <span>♪ Aquí entra el video karaoke después de la transición ♪</span>
                  </div>
                </>
              )}
            </div>

            {showIntro && (
              <div className="tv-intro-screen tv-intro-screen-over-video">
                <div className="intro-orbit" />

                <div className="intro-avatar">{currentSong.avatar}</div>

                <span>{hasPlayableVideo ? "Preparando karaoke" : "Ahora canta"}</span>

                <h1 className="gold-user-name">{currentSong.user}</h1>

                <p>{currentSong.title}</p>

                <div className="intro-countdown">{countdown}</div>
              </div>
            )}

            <div className="tv-qr-small">
              <QRCodeCanvas value={roomUrl} size={130} />

              <p>Únete</p>

              <strong>{roomCode}</strong>
            </div>

            <div
              className={`tv-current tv-overlay-ui ${
                showTvOverlay ? "tv-ui-visible" : "tv-ui-hidden"
              }`}
            >
              <div className="song-avatar">{currentSong.avatar}</div>

              <div>
                <span>Ahora canta</span>

                <h3 className="gold-user-name">{currentSong.user}</h3>
              </div>
            </div>
          </>
        ) : currentIdleItem.type === "promo" ? (
          <PromoTvSlide
            promoSettings={currentIdleItem.promo}
            roomUrl={roomUrl}
            roomCode={roomCode}
          />
        ) : (
          <div className="tv-idle tv-idle-full premium-idle">
            <div className="big-tv-logo pulse-logo">
              {brandLogo ? <img className="tv-brand-logo-img" src={brandLogo} alt={brandName} /> : <Mic2 size={70} />}
            </div>

            <h1>{karaokePaused ? "Corte activo" : brandRoom?.publicTitle || "Karaoke Night"}</h1>

            <p>
              {karaokePaused
                ? "El karaoke está pausado. Escanea el QR mientras regresamos."
                : brandRoom?.slogan || "Escanea el QR para pedir tu canción"}
            </p>

            <div className="qr-large qr-pulse">
              <QRCodeCanvas value={roomUrl} size={260} />
            </div>

            <div className="big-code tv-code">{roomCode}</div>

            <div className="tv-promo">{brandName || "SPACEOKE"} · Turnos justos y karaoke automático</div>
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
