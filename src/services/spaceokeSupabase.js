import { supabase } from "../lib/supabaseClient";

const APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, "");
const ACTIVE_STATUSES = ["queued", "playing"];
const HISTORY_STATUSES = ["done", "cancelled", "no_show", "skipped", "video_error"];
const ACTIVE_USER_TTL_SECONDS = 45;

export const makeTicket = (text) => {
  return (text || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 14);
};

export const normalizeSearchQuery = (text) => {
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

export const normalizeSongKey = (text) => {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

export const roomToUi = (room) => {
  if (!room) return null;

  return {
    id: room.id,
    ticket: room.ticket,
    adminPin: room.admin_pin,
    active: room.active,
    expiresAt: room.expires_at,
    createdAt: room.created_at,
    renewedAt: room.renewed_at,
    businessName: room.business_name,
    publicTitle: room.public_title,
    slogan: room.slogan,
    instagram: room.instagram || "",
    location: room.location || "",
    logo: room.logo_url || "",
    theme: {
      primary: room.primary_color || "#8b5cf6",
      secondary: room.secondary_color || "#ec4899",
      background: room.background_color || "#070713",
    },
    stats: {
      totalSongsPlayed: room.total_songs_played || 0,
      totalSingers: room.total_singers || 0,
      totalSessions: room.total_sessions || 0,
      lastActivity: room.last_activity,
    },
  };
};

export const promoToUi = (promo) => ({
  id: promo.id,
  enabled: promo.enabled,
  title: promo.title || "",
  subtitle: promo.subtitle || "",
  description: promo.description || "",
  instagram: promo.instagram || "",
  font: promo.font || "display",
  duration: promo.duration || 7,
  image: promo.image_url || "",
  imageName: promo.image_name || "",
});

export const songToUi = (song) => ({
  id: song.id,
  ownerId: song.owner_id,
  title: song.title,
  artist: song.artist || "YouTube Karaoke",
  user: song.singer_name,
  avatar: song.avatar || "🎤",
  duration: song.duration || "—",
  repeatKey: song.repeat_key || 0,
  status: song.status,
  requestedAt: song.requested_at,
  startedAt: song.started_at,
  endedAt: song.ended_at,
  retryCount: song.retry_count || 0,
  versionKey: song.version_key,
  youtubeId: song.youtube_id,
  youtubeUrl: song.youtube_url,
  localVideoUrl: song.local_video_url,
  source: song.source,
  thumbnail: song.thumbnail,
  videoErrorReason: song.video_error_reason,
  retriedAfterError: song.retried_after_error,
});

export const videoToUi = (video) => ({
  youtubeId: video.youtube_id,
  originalYoutubeId: video.original_youtube_id,
  title: video.title,
  channelTitle: video.channel_title || "YouTube",
  thumbnail: video.thumbnail || "",
  url: video.url || (video.youtube_id ? `https://www.youtube.com/watch?v=${video.youtube_id}` : video.local_video_url),
  localVideoUrl: video.local_video_url || "",
  searchQuery: video.search_query || "",
  normalizedQuery: video.normalized_query || "",
  isKaraoke: video.is_karaoke,
  blocked: video.blocked,
  source: video.source || "youtube",
  playCount: video.play_count || 0,
  requestedCount: video.requested_count || 0,
  lastUsedAt: video.last_used_at,
  createdAt: video.created_at,
});

export const blockedVideoToUi = (video) => ({
  youtubeId: video.youtube_id,
  title: video.title || "Video bloqueado",
  channelTitle: video.channel_title || "YouTube",
  thumbnail: video.thumbnail || "",
  url: video.url || (video.youtube_id ? `https://www.youtube.com/watch?v=${video.youtube_id}` : ""),
  reason: video.reason || "No se pudo reproducir en TV",
  blockedAt: video.blocked_at,
  resolvedWithLocal: Boolean(video.resolved_with_local),
  localVideoUrl: video.local_video_url || "",
  resolvedAt: video.resolved_at,
});

export async function uploadPublicFile(bucket, path, file) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    cacheControl: "3600",
  });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export async function listPrivateRooms() {
  const { data, error } = await supabase
    .from("private_rooms")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(roomToUi);
}

export async function getRoomByTicket(ticket) {
  const clean = makeTicket(ticket);
  const { data, error } = await supabase
    .from("private_rooms")
    .select("*")
    .eq("ticket", clean)
    .maybeSingle();
  if (error) throw error;
  return roomToUi(data);
}

export async function createPrivateRoom(form) {
  const ticket = makeTicket(form.ticket || form.businessName);
  const row = {
    ticket,
    admin_pin: form.adminPin || "5050",
    active: true,
    expires_at: form.expiresAt,
    business_name: form.businessName || ticket,
    public_title: form.publicTitle || "Karaoke Night",
    slogan: form.slogan || "Escanea el QR para pedir tu canción",
    instagram: form.instagram || "",
    location: form.location || "",
    logo_url: form.logo || "",
    primary_color: form.primary || "#8b5cf6",
    secondary_color: form.secondary || "#ec4899",
    background_color: form.background || "#070713",
    last_activity: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("private_rooms").insert(row).select("*").single();
  if (error) throw error;

  const promos = [1, 2, 3].map((promo_number) => ({ room_ticket: ticket, promo_number }));
  await supabase.from("room_promos").upsert(promos, { onConflict: "room_ticket,promo_number" });

  return roomToUi(data);
}

export async function updatePrivateRoom(roomId, form) {
  const row = {
    ticket: makeTicket(form.ticket),
    admin_pin: form.adminPin || "5050",
    business_name: form.businessName,
    public_title: form.publicTitle,
    slogan: form.slogan,
    instagram: form.instagram,
    location: form.location,
    logo_url: form.logo,
    expires_at: form.expiresAt,
    primary_color: form.primary,
    secondary_color: form.secondary,
    background_color: form.background,
    last_activity: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("private_rooms").update(row).eq("id", roomId).select("*").single();
  if (error) throw error;
  return roomToUi(data);
}

export async function renewPrivateRoom(roomId, days = 30) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const expiresAt = date.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("private_rooms")
    .update({ active: true, expires_at: expiresAt, renewed_at: new Date().toISOString() })
    .eq("id", roomId)
    .select("*")
    .single();
  if (error) throw error;
  return roomToUi(data);
}

export async function togglePrivateRoom(roomId, active) {
  const { data, error } = await supabase
    .from("private_rooms")
    .update({ active })
    .eq("id", roomId)
    .select("*")
    .single();
  if (error) throw error;
  return roomToUi(data);
}

export async function deletePrivateRoom(roomId) {
  const { error } = await supabase.from("private_rooms").delete().eq("id", roomId);
  if (error) throw error;
}

export async function listPromos(ticket) {
  const { data, error } = await supabase
    .from("room_promos")
    .select("*")
    .eq("room_ticket", makeTicket(ticket))
    .order("promo_number", { ascending: true });
  if (error) throw error;

  if (!data || data.length === 0) {
    const empty = [1, 2, 3].map((promo_number) => ({ room_ticket: makeTicket(ticket), promo_number }));
    await supabase.from("room_promos").upsert(empty, { onConflict: "room_ticket,promo_number" });
    return listPromos(ticket);
  }

  return data.map(promoToUi);
}

export async function savePromo(ticket, promoNumber, promo) {
  const row = {
    room_ticket: makeTicket(ticket),
    promo_number: promoNumber,
    enabled: promo.enabled,
    title: promo.title || "",
    subtitle: promo.subtitle || "",
    description: promo.description || "",
    instagram: promo.instagram || "",
    font: promo.font || "display",
    duration: Number(promo.duration || 7),
    image_url: promo.image || "",
    image_name: promo.imageName || "",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("room_promos")
    .upsert(row, { onConflict: "room_ticket,promo_number" })
    .select("*")
    .single();
  if (error) throw error;
  return promoToUi(data);
}

export async function listQueue(ticket) {
  const { data, error } = await supabase
    .from("songs_queue")
    .select("*")
    .eq("room_ticket", makeTicket(ticket))
    .order("requested_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(songToUi);
}

export async function addSong(ticket, song) {
  const current = await listQueue(ticket);
  const active = current.filter((s) => ACTIVE_STATUSES.includes(s.status));
  const shouldPlayNow = !active.some((s) => s.status === "playing");

  const row = {
    room_ticket: makeTicket(ticket),
    owner_id: song.ownerId,
    singer_name: song.user,
    avatar: song.avatar || "🎤",
    title: song.title,
    artist: song.artist || "YouTube Karaoke",
    duration: song.duration || "—",
    status: shouldPlayNow ? "playing" : "queued",
    youtube_id: song.youtubeId || null,
    youtube_url: song.youtubeUrl || null,
    local_video_url: song.localVideoUrl || null,
    source: song.source || (song.localVideoUrl ? "local" : "youtube"),
    thumbnail: song.thumbnail || "",
    version_key: song.versionKey || normalizeSongKey(song.localVideoUrl || song.youtubeId || song.title),
    requested_at: new Date().toISOString(),
    started_at: shouldPlayNow ? new Date().toISOString() : null,
  };

  const { data, error } = await supabase.from("songs_queue").insert(row).select("*").single();
  if (error) throw error;
  return songToUi(data);
}

export async function updateSong(songId, patch) {
  const row = {
    status: patch.status,
    ended_at: patch.endedAt,
    started_at: patch.startedAt,
    retry_count: patch.retryCount,
    repeat_key: patch.repeatKey,
    video_error_reason: patch.videoErrorReason,
    retried_after_error: patch.retriedAfterError,
  };
  Object.keys(row).forEach((key) => row[key] === undefined && delete row[key]);

  const { data, error } = await supabase.from("songs_queue").update(row).eq("id", songId).select("*").single();
  if (error) throw error;
  return songToUi(data);
}

export async function nextSong(ticket, currentSongId) {
  const roomTicket = makeTicket(ticket);
  const now = new Date().toISOString();

  if (currentSongId) {
    await supabase
      .from("songs_queue")
      .update({ status: "done", ended_at: now })
      .eq("id", currentSongId);

    await incrementSongPlayed(roomTicket);
  }

  const { data: next, error } = await supabase
    .from("songs_queue")
    .select("*")
    .eq("room_ticket", roomTicket)
    .eq("status", "queued")
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!next) return null;

  const { data: playing, error: playError } = await supabase
    .from("songs_queue")
    .update({ status: "playing", started_at: now, ended_at: null })
    .eq("id", next.id)
    .select("*")
    .single();

  if (playError) throw playError;

  await touchRoom(roomTicket);
  return songToUi(playing);
}


export async function cancelSong(songId) {
  return updateSong(songId, { status: "cancelled", endedAt: new Date().toISOString() });
}

export async function markVideoError(song, reason) {
  if (song.youtubeId && !song.localVideoUrl) {
    await blockVideo(song, reason);
  }
  return updateSong(song.id, {
    status: "video_error",
    endedAt: new Date().toISOString(),
    videoErrorReason: reason,
  });
}


export async function searchLocalCatalog(query) {
  const clean = normalizeSearchQuery(query).replace(" karaoke", "").trim();

  if (!clean) return [];

  const { data, error } = await supabase
    .from("video_catalog")
    .select("*")
    .or(`normalized_query.ilike.%${clean}%,title.ilike.%${clean}%,channel_title.ilike.%${clean}%`)
    .eq("blocked", false)
    .order("requested_count", { ascending: false })
    .limit(8);

  if (error) throw error;
  return (data || []).map(videoToUi);
}

export async function upsertVideos(videos = []) {
  const rows = videos
    .filter((video) => video?.youtubeId)
    .map((video) => ({
      youtube_id: video.youtubeId,
      original_youtube_id: video.originalYoutubeId || null,
      title: video.title,
      channel_title: video.channelTitle || "YouTube",
      thumbnail: video.thumbnail || "",
      url: video.url || (video.youtubeId ? `https://www.youtube.com/watch?v=${video.youtubeId}` : video.localVideoUrl),
      local_video_url: video.localVideoUrl || null,
      search_query: video.searchQuery || video.title,
      normalized_query: video.normalizedQuery || normalizeSearchQuery(`${video.title} ${video.channelTitle || ""}`),
      is_karaoke: video.isKaraoke !== false,
      blocked: Boolean(video.blocked),
      source: video.source || (video.localVideoUrl ? "local" : "youtube-api"),
      last_used_at: video.lastUsedAt || null,
    }));

  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from("video_catalog")
    .upsert(rows, { onConflict: "youtube_id" })
    .select("*");

  if (error) throw error;
  return (data || []).map(videoToUi);
}

export async function searchKaraoke(query) {
  const normalized = normalizeSearchQuery(query);
  const clean = normalized.replace(" karaoke", "").trim();

  const localMatches = await searchLocalCatalog(clean);
  if (localMatches.length > 0) {
    return localMatches;
  }

  const { data, error } = await supabase.functions.invoke("youtube-search", {
    body: { query: normalized },
  });

  if (error) throw error;

  const results = (data?.results || [])
    .map(videoToUi)
    .filter((video) => !video.blocked);

  if (results.length > 0) {
    await upsertVideos(results);
  }

  return results;
}


export async function listVideoCatalog() {
  const { data, error } = await supabase
    .from("video_catalog")
    .select("*")
    .order("requested_count", { ascending: false });
  if (error) throw error;
  return (data || []).map(videoToUi);
}

export async function markVideoRequested(video) {
  const row = {
    youtube_id: video.youtubeId,
    original_youtube_id: video.originalYoutubeId || null,
    title: video.title,
    channel_title: video.channelTitle,
    thumbnail: video.thumbnail || "",
    url: video.url || null,
    local_video_url: video.localVideoUrl || null,
    search_query: video.searchQuery || video.title,
    normalized_query: video.normalizedQuery || normalizeSearchQuery(`${video.title} ${video.channelTitle}`),
    source: video.source || (video.localVideoUrl ? "local" : "youtube"),
    requested_count: 1,
    last_used_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase.from("video_catalog").select("requested_count").eq("youtube_id", video.youtubeId).maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("video_catalog")
      .update({ requested_count: (existing.requested_count || 0) + 1, last_used_at: new Date().toISOString() })
      .eq("youtube_id", video.youtubeId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("video_catalog").insert(row);
    if (error) throw error;
  }
}


async function getBlockedVideo(youtubeId) {
  const { data, error } = await supabase
    .from("blocked_videos")
    .select("*")
    .eq("youtube_id", youtubeId)
    .maybeSingle();

  if (error) throw error;
  return data ? blockedVideoToUi(data) : null;
}

export async function addLocalVideo(video) {
  const originalYoutubeId = String(video.originalYoutubeId || "").trim();
  const youtubeId =
    originalYoutubeId ||
    `local-video-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const blocked = originalYoutubeId ? await getBlockedVideo(originalYoutubeId).catch(() => null) : null;

  const row = {
    youtube_id: youtubeId,
    original_youtube_id: originalYoutubeId || null,
    title: video.title || blocked?.title || "Karaoke local",
    channel_title: video.channelTitle || blocked?.channelTitle || "Biblioteca local",
    thumbnail: video.thumbnail || blocked?.thumbnail || "",
    url: video.url || blocked?.url || (originalYoutubeId ? `https://www.youtube.com/watch?v=${originalYoutubeId}` : video.localVideoUrl),
    local_video_url: video.localVideoUrl,
    search_query: video.searchQuery || video.title || blocked?.title || "",
    normalized_query: normalizeSearchQuery(
      `${video.searchQuery || video.title || blocked?.title || ""} ${video.channelTitle || blocked?.channelTitle || ""}`
    ),
    source: "local",
    is_karaoke: true,
    blocked: false,
    blocked_reason: null,
    last_used_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("video_catalog")
    .upsert(row, { onConflict: "youtube_id" })
    .select("*")
    .single();

  if (error) throw error;

  if (originalYoutubeId) {
    await supabase
      .from("blocked_videos")
      .update({
        resolved_with_local: true,
        local_video_url: video.localVideoUrl,
        resolved_at: new Date().toISOString(),
      })
      .eq("youtube_id", originalYoutubeId);
  }

  return videoToUi(data);
}


export async function blockVideo(songOrVideo, reason = "No se pudo reproducir en TV") {
  const youtubeId = songOrVideo.youtubeId;
  if (!youtubeId) return;

  const baseRow = {
    youtube_id: youtubeId,
    title: songOrVideo.title || "Video bloqueado",
    channel_title: songOrVideo.artist || songOrVideo.channelTitle || "YouTube",
    url: songOrVideo.youtubeUrl || songOrVideo.url || `https://www.youtube.com/watch?v=${youtubeId}`,
    reason,
    blocked_at: new Date().toISOString(),
    resolved_with_local: false,
  };

  const rowWithThumbnail = {
    ...baseRow,
    thumbnail: songOrVideo.thumbnail || "",
  };

  let blockedResult = await supabase
    .from("blocked_videos")
    .upsert(rowWithThumbnail, { onConflict: "youtube_id" });

  if (blockedResult.error) {
    blockedResult = await supabase
      .from("blocked_videos")
      .upsert(baseRow, { onConflict: "youtube_id" });
  }

  if (blockedResult.error) throw blockedResult.error;

  const { error } = await supabase
    .from("video_catalog")
    .upsert(
      {
        youtube_id: youtubeId,
        title: baseRow.title,
        channel_title: baseRow.channel_title,
        thumbnail: songOrVideo.thumbnail || "",
        url: baseRow.url,
        local_video_url: null,
        search_query: baseRow.title,
        normalized_query: normalizeSearchQuery(`${baseRow.title} ${baseRow.channel_title}`),
        is_karaoke: true,
        blocked: true,
        blocked_reason: reason,
        source: "youtube-api",
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "youtube_id" }
    );

  if (error) throw error;
}


export async function listBlockedVideos(includeResolved = true) {
  let query = supabase
    .from("blocked_videos")
    .select("*")
    .order("blocked_at", { ascending: false });

  if (!includeResolved) {
    query = query.eq("resolved_with_local", false);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(blockedVideoToUi);
}



export async function clearVideoCatalog() {
  const { error: catalogError } = await supabase
    .from("video_catalog")
    .delete()
    .neq("youtube_id", "__never__");

  if (catalogError) throw catalogError;

  const { error: blockedError } = await supabase
    .from("blocked_videos")
    .delete()
    .neq("youtube_id", "__never__");

  if (blockedError) throw blockedError;
}

export async function heartbeatUser(ticket, playerId, userData) {
  const row = {
    room_ticket: makeTicket(ticket),
    player_id: playerId,
    display_name: userData.displayName,
    avatar: userData.avatar,
    last_seen_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("room_users").upsert(row, { onConflict: "room_ticket,player_id" });
  if (error) throw error;
}

export async function removeUser(ticket, playerId) {
  const { error } = await supabase.from("room_users").delete().eq("room_ticket", makeTicket(ticket)).eq("player_id", playerId);
  if (error) throw error;
}

export async function listActiveUsers(ticket) {
  const since = new Date(Date.now() - ACTIVE_USER_TTL_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from("room_users")
    .select("*")
    .eq("room_ticket", makeTicket(ticket))
    .gte("last_seen_at", since)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export function subscribeRoom(ticket, onChange) {
  const roomTicket = makeTicket(ticket);
  const channel = supabase
    .channel(`room:${roomTicket}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "songs_queue", filter: `room_ticket=eq.${roomTicket}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_promos", filter: `room_ticket=eq.${roomTicket}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_sessions", filter: `room_ticket=eq.${roomTicket}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "private_rooms", filter: `ticket=eq.${roomTicket}` }, onChange)
    .subscribe();

  return () => supabase.removeChannel(channel);
}

export function buildRoomLinks(ticket) {
  const clean = makeTicket(ticket);
  return {
    sala: `${APP_URL}/sala/${clean}`,
    tv: `${APP_URL}/tv/${clean}`,
    admin: `${APP_URL}/admin/${clean}`,
  };
}


export const sessionToUi = (session) => {
  if (!session) return null;
  return {
    roomTicket: session.room_ticket,
    isPublic: session.is_public,
    active: session.active,
    karaokePaused: session.karaoke_paused,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    closedAt: session.closed_at,
  };
};

export async function ensureRoomSession(ticket, options = {}) {
  const roomTicket = makeTicket(ticket);

  const existing = await getRoomSession(roomTicket);
  if (existing && !options.reopen) {
    return existing;
  }

  const row = {
    room_ticket: roomTicket,
    is_public: Boolean(options.isPublic),
    active: true,
    karaoke_paused: false,
    updated_at: new Date().toISOString(),
    closed_at: null,
  };

  const { data, error } = await supabase
    .from("room_sessions")
    .upsert(row, { onConflict: "room_ticket" })
    .select("*")
    .single();

  if (error) throw error;
  return sessionToUi(data);
}

export async function getRoomSession(ticket) {
  const { data, error } = await supabase
    .from("room_sessions")
    .select("*")
    .eq("room_ticket", makeTicket(ticket))
    .maybeSingle();
  if (error) throw error;
  return sessionToUi(data);
}


export async function createPublicRoom(ticket) {
  const roomTicket = makeTicket(ticket);
  const session = await ensureRoomSession(roomTicket, { isPublic: true, reopen: true });
  const emptyPromos = [1, 2, 3].map((promo_number) => ({ room_ticket: roomTicket, promo_number }));
  await supabase.from("room_promos").upsert(emptyPromos, { onConflict: "room_ticket,promo_number" });
  return session;
}

export async function roomExists(ticket) {
  const roomTicket = makeTicket(ticket);

  const privateRoom = await getRoomByTicket(roomTicket);
  if (privateRoom && privateRoom.active) {
    return {
      exists: true,
      type: "private",
      room: privateRoom,
      session: await ensureRoomSession(roomTicket, { isPublic: false }),
    };
  }

  const session = await getRoomSession(roomTicket);
  if (session?.active) {
    return {
      exists: true,
      type: session.isPublic ? "public" : "private",
      room: null,
      session,
    };
  }

  return {
    exists: false,
    type: null,
    room: null,
    session: null,
  };
}

export async function setRoomPaused(ticket, paused) {
  await ensureRoomSession(ticket, { isPublic: false });
  const { data, error } = await supabase
    .from("room_sessions")
    .update({ karaoke_paused: Boolean(paused), updated_at: new Date().toISOString() })
    .eq("room_ticket", makeTicket(ticket))
    .select("*")
    .single();
  if (error) throw error;
  return sessionToUi(data);
}


export async function deletePublicRoom(ticket) {
  const roomTicket = makeTicket(ticket);

  await supabase
    .from("songs_queue")
    .delete()
    .eq("room_ticket", roomTicket);

  await supabase
    .from("room_users")
    .delete()
    .eq("room_ticket", roomTicket);

  await supabase
    .from("room_promos")
    .delete()
    .eq("room_ticket", roomTicket);

  const { error } = await supabase
    .from("room_sessions")
    .delete()
    .eq("room_ticket", roomTicket)
    .eq("is_public", true);

  if (error) throw error;
  return true;
}

export async function closeRoom(ticket, options = {}) {
  const roomTicket = makeTicket(ticket);
  const now = new Date().toISOString();
  const session = await getRoomSession(roomTicket);

  await supabase
    .from("songs_queue")
    .delete()
    .eq("room_ticket", roomTicket);

  await supabase
    .from("room_users")
    .delete()
    .eq("room_ticket", roomTicket);

  if (session?.isPublic || options.forceDeleteSession) {
    await supabase
      .from("room_promos")
      .delete()
      .eq("room_ticket", roomTicket);

    const { error } = await supabase
      .from("room_sessions")
      .delete()
      .eq("room_ticket", roomTicket);

    if (error) throw error;
    return true;
  }

  const { data, error } = await supabase
    .from("room_sessions")
    .update({ active: false, karaoke_paused: false, closed_at: now, updated_at: now })
    .eq("room_ticket", roomTicket)
    .select("*")
    .single();

  if (error) throw error;
  return sessionToUi(data);
}



async function promoteNextQueued(ticket) {
  const roomTicket = makeTicket(ticket);
  const now = new Date().toISOString();

  const { data: nextSong, error: findError } = await supabase
    .from("songs_queue")
    .select("*")
    .eq("room_ticket", roomTicket)
    .eq("status", "queued")
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (!nextSong) return null;

  const { data, error } = await supabase
    .from("songs_queue")
    .update({
      status: "playing",
      started_at: now,
      ended_at: null,
    })
    .eq("id", nextSong.id)
    .select("*")
    .single();

  if (error) throw error;

  await supabase
    .from("room_sessions")
    .update({ updated_at: now })
    .eq("room_ticket", roomTicket);

  await supabase
    .from("private_rooms")
    .update({ last_activity: now })
    .eq("ticket", roomTicket);

  return songToUi(data);
}

export async function cancelSongAndPromote(ticket, songId) {
  const roomTicket = makeTicket(ticket);
  const now = new Date().toISOString();
  const { data: song, error: findError } = await supabase.from("songs_queue").select("*").eq("id", songId).maybeSingle();
  if (findError) throw findError;

  const { error } = await supabase
    .from("songs_queue")
    .update({ status: "cancelled", ended_at: now })
    .eq("id", songId);
  if (error) throw error;

  if (song?.status === "playing") {
    return promoteNextQueued(roomTicket);
  }
  return null;
}

export async function playSongNow(ticket, songId) {
  const roomTicket = makeTicket(ticket);
  const now = new Date().toISOString();

  await supabase
    .from("songs_queue")
    .update({ status: "queued", ended_at: null })
    .eq("room_ticket", roomTicket)
    .eq("status", "playing");

  const { data, error } = await supabase
    .from("songs_queue")
    .update({ status: "playing", started_at: now, ended_at: null })
    .eq("id", songId)
    .select("*")
    .single();
  if (error) throw error;
  return songToUi(data);
}

export async function moveSongUp(ticket, songId) {
  const songs = await listQueue(ticket);
  const active = songs.filter((song) => ACTIVE_STATUSES.includes(song.status));
  const index = active.findIndex((song) => song.id === songId);
  if (index <= 0) return null;

  const previous = active[index - 1];
  const current = active[index];

  if (previous.status === "playing") return null;

  const { error: e1 } = await supabase.from("songs_queue").update({ requested_at: previous.requestedAt }).eq("id", current.id);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("songs_queue").update({ requested_at: current.requestedAt }).eq("id", previous.id);
  if (e2) throw e2;
  return true;
}

export async function repeatSong(songId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("songs_queue")
    .update({ repeat_key: String(Date.now()), status: "playing", started_at: now, ended_at: null })
    .eq("id", songId)
    .select("*")
    .single();
  if (error) throw error;
  return songToUi(data);
}

function songUiToInsertRow(ticket, song, overrides = {}) {
  return {
    room_ticket: makeTicket(ticket),
    owner_id: song.ownerId,
    singer_name: song.user,
    avatar: song.avatar || "🎤",
    title: song.title,
    artist: song.artist || "YouTube Karaoke",
    duration: song.duration || "—",
    status: overrides.status || "queued",
    youtube_id: song.youtubeId || null,
    youtube_url: song.youtubeUrl || null,
    local_video_url: song.localVideoUrl || null,
    source: song.source || (song.localVideoUrl ? "local" : "youtube"),
    thumbnail: song.thumbnail || "",
    version_key: song.versionKey || normalizeSongKey(song.localVideoUrl || song.youtubeId || song.title),
    retry_count: overrides.retryCount ?? ((song.retryCount || 0) + 1),
    repeat_key: null,
    requested_at: new Date().toISOString(),
    started_at: overrides.status === "playing" ? new Date().toISOString() : null,
    ended_at: null,
  };
}

export async function markNoShowAndPromote(ticket, currentSong, maxRetries = 2) {
  const now = new Date().toISOString();
  const retryCount = (currentSong.retryCount || 0) + 1;

  await supabase
    .from("songs_queue")
    .update({ status: "no_show", ended_at: now, retry_count: retryCount })
    .eq("id", currentSong.id);

  if (retryCount <= maxRetries) {
    await supabase.from("songs_queue").insert(songUiToInsertRow(ticket, currentSong, { status: "queued", retryCount }));
  }

  return promoteNextQueued(ticket);
}

export async function reinsertSong(ticket, song) {
  const active = (await listQueue(ticket)).filter((item) => ACTIVE_STATUSES.includes(item.status));
  const shouldPlayNow = !active.some((item) => item.status === "playing");
  const row = songUiToInsertRow(ticket, song, {
    status: shouldPlayNow ? "playing" : "queued",
    retryCount: (song.retryCount || 0) + 1,
  });
  const { data, error } = await supabase.from("songs_queue").insert(row).select("*").single();
  if (error) throw error;
  return songToUi(data);
}

export async function cancelSongsByOwner(ticket, ownerId) {
  const roomTicket = makeTicket(ticket);
  const now = new Date().toISOString();
  const activeBefore = (await listQueue(roomTicket)).filter((song) => ACTIVE_STATUSES.includes(song.status) && song.ownerId === ownerId);

  const { error } = await supabase
    .from("songs_queue")
    .update({ status: "cancelled", ended_at: now })
    .eq("room_ticket", roomTicket)
    .eq("owner_id", ownerId)
    .in("status", ACTIVE_STATUSES);
  if (error) throw error;

  if (activeBefore.some((song) => song.status === "playing")) {
    return promoteNextQueued(roomTicket);
  }
  return null;
}

export async function markVideoErrorAndSkip(ticket, song, reason = "No se pudo reproducir en TV") {
  await markVideoError(song, reason);
  return promoteNextQueued(ticket);
}


export async function markVideoErrorAndPromote(ticket, songOrId, reason = "No se pudo reproducir en TV") {
  const song =
    typeof songOrId === "object"
      ? songOrId
      : (await listQueue(ticket)).find((item) => item.id === songOrId);

  if (!song) return null;

  await markVideoError(song, reason);
  return promoteNextQueued(ticket);
}

export async function cleanupInactiveUsersAndTurns(ticket) {
  const roomTicket = makeTicket(ticket);
  const since = new Date(Date.now() - ACTIVE_USER_TTL_SECONDS * 1000).toISOString();

  const { data: staleUsers, error } = await supabase
    .from("room_users")
    .select("player_id")
    .eq("room_ticket", roomTicket)
    .lt("last_seen_at", since);
  if (error) throw error;

  for (const user of staleUsers || []) {
    await cancelSongsByOwner(roomTicket, user.player_id);
    await removeUser(roomTicket, user.player_id);
  }

  return staleUsers || [];
}


/* =========================================================
   DEV PANEL / MONITOREO REALTIME
   ========================================================= */

export async function listRoomSessions() {
  const { data, error } = await supabase
    .from("room_sessions")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(sessionToUi);
}

export async function getRoomSnapshot(ticket) {
  const roomTicket = makeTicket(ticket);

  const [session, queue, users, privateRoom] = await Promise.all([
    getRoomSession(roomTicket),
    listQueue(roomTicket),
    listActiveUsers(roomTicket),
    getRoomByTicket(roomTicket).catch(() => null),
  ]);

  const activeQueue = queue.filter((song) => ACTIVE_STATUSES.includes(song.status));
  const history = queue.filter((song) => HISTORY_STATUSES.includes(song.status));

  return {
    ticket: roomTicket,
    session,
    privateRoom,
    isPrivate: Boolean(privateRoom),
    activeQueue,
    history,
    users,
    currentSong: activeQueue.find((song) => song.status === "playing") || null,
    stats: {
      active: activeQueue.length,
      done: history.filter((song) => song.status === "done").length,
      cancelled: history.filter((song) => song.status === "cancelled").length,
      noShow: history.filter((song) => song.status === "no_show").length,
      videoError: history.filter((song) => song.status === "video_error").length,
      users: users.length,
      singers: new Set(queue.map((song) => song.user).filter(Boolean)).size,
      totalSongs: queue.length,
    },
  };
}

export async function listDevDashboardData() {
  const [privateRooms, sessions, catalog, blockedVideos] = await Promise.all([
    listPrivateRooms(),
    listRoomSessions(),
    listVideoCatalog().catch(() => []),
    listBlockedVideos(true).catch(() => []),
  ]);

  const snapshots = await Promise.all(
    sessions.map((session) => getRoomSnapshot(session.roomTicket).catch(() => null))
  );

  return {
    privateRooms,
    sessions,
    snapshots: snapshots.filter(Boolean),
    catalog,
    blockedVideos,
  };
}

export function subscribeDevPanel(onChange) {
  const channel = supabase
    .channel("dev-panel")
    .on("postgres_changes", { event: "*", schema: "public", table: "private_rooms" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_sessions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_users" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "songs_queue" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_promos" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "video_catalog" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "blocked_videos" }, onChange)
    .subscribe();

  return () => supabase.removeChannel(channel);
}


async function touchRoom(ticket) {
  const roomTicket = makeTicket(ticket);
  const now = new Date().toISOString();

  await supabase
    .from("room_sessions")
    .update({ updated_at: now })
    .eq("room_ticket", roomTicket);

  await supabase
    .from("private_rooms")
    .update({ last_activity: now })
    .eq("ticket", roomTicket);
}

async function incrementSongPlayed(ticket) {
  const roomTicket = makeTicket(ticket);

  const session = await getRoomSession(roomTicket).catch(() => null);
  if (session) {
    await supabase
      .from("room_sessions")
      .update({
        total_songs_played: (session.totalSongsPlayed || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("room_ticket", roomTicket)
      .then(() => null);
  }

  const room = await getRoomByTicket(roomTicket).catch(() => null);
  if (room) {
    await supabase
      .from("private_rooms")
      .update({
        total_songs_played: (room.stats?.totalSongsPlayed || 0) + 1,
        last_activity: new Date().toISOString(),
      })
      .eq("ticket", roomTicket)
      .then(() => null);
  }
}


/* =========================================================
   ALIASES PARA DEV PANEL / COMPATIBILIDAD MAIN.JSX
   ========================================================= */

export async function listRoomsOverview() {
  if (typeof listDevDashboardData === "function") {
    const data = await listDevDashboardData();
    const snapshots = data.snapshots || [];
    const privateRooms = data.privateRooms || [];

    const privateCards = privateRooms.map((room) => {
      const snap = snapshots.find((item) => item.ticket === room.ticket);
      return {
        ...room,
        roomType: "private",
        isPrivate: true,
        activeUsers: snap?.users?.length || 0,
        activeSongs: snap?.activeQueue?.length || 0,
        historySongs: snap?.history?.length || 0,
        currentSong: snap?.currentSong || null,
      };
    });

    const publicCards = snapshots
      .filter((snap) => !snap.isPrivate)
      .map((snap) => ({
        id: snap.session?.id || snap.ticket,
        ticket: snap.ticket,
        businessName: `Sala pública ${snap.ticket}`,
        publicTitle: "Karaoke público",
        slogan: "Sala creada desde la página principal",
        logo: "",
        active: Boolean(snap.session?.active),
        roomType: "public",
        isPrivate: false,
        expiresAt: null,
        stats: {
          totalSongsPlayed: snap.session?.totalSongsPlayed || snap.stats?.done || 0,
          totalSingers: snap.stats?.singers || 0,
          totalSessions: snap.session?.totalSessions || 1,
          lastActivity: snap.session?.lastActivity || snap.session?.updatedAt || null,
        },
        activeUsers: snap.users?.length || 0,
        activeSongs: snap.activeQueue?.length || 0,
        historySongs: snap.history?.length || 0,
        currentSong: snap.currentSong || null,
      }));

    return [...privateCards, ...publicCards];
  }

  return listPrivateRooms();
}

export function subscribeDevDashboard(onChange) {
  if (typeof subscribeDevPanel === "function") {
    return subscribeDevPanel(onChange);
  }
  return () => {};
}
