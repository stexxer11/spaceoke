declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(
    handler: (request: Request) => Response | Promise<Response>
  ): void;
};

type YoutubeVideoResult = {
  youtube_id: string;
  original_youtube_id: string | null;
  title: string;
  channel_title: string;
  thumbnail: string;
  url: string;
  local_video_url: string;
  search_query: string;
  normalized_query: string;
  is_karaoke: boolean;
  blocked: boolean;
  source: string;
  play_count: number;
  requested_count: number;
  last_used_at: string | null;
  created_at: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const positiveWords = [
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

const blockedWords = [
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

const trustedChannels = [
  "karaoke version",
  "sing king",
  "karafun",
  "the karaoke channel",
  "tracks planet",
  "karaoke latino",
];

function normalizeSearchQuery(text: string) {
  const base = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) return "";
  return base.includes("karaoke") ? base : `${base} karaoke`;
}

function looksLikeKaraoke(video: YoutubeVideoResult) {
  const haystack = `${video.title || ""} ${video.channel_title || ""}`.toLowerCase();

  if (blockedWords.some((word) => haystack.includes(word))) {
    return false;
  }

  return positiveWords.some((word) => haystack.includes(word));
}

function scoreVideo(video: YoutubeVideoResult) {
  const haystack = `${video.title || ""} ${video.channel_title || ""}`.toLowerCase();
  let score = 0;

  positiveWords.forEach((word) => {
    if (haystack.includes(word)) score += 2;
  });

  trustedChannels.forEach((channel) => {
    if (haystack.includes(channel)) score += 4;
  });

  blockedWords.forEach((word) => {
    if (haystack.includes(word)) score -= 5;
  });

  return score;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const apiKey = Deno.env.get("YOUTUBE_API_KEY");

    if (!apiKey) {
      return jsonResponse(
        {
          error:
            "Falta configurar YOUTUBE_API_KEY en Supabase Edge Function Secrets.",
        },
        500
      );
    }

    const body = await req.json().catch(() => ({} as { query?: string }));
    const query = normalizeSearchQuery(body.query || "");

    if (query.length < 4) {
      return jsonResponse({
        results: [],
        message: "Consulta muy corta.",
      });
    }

    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: "8",
      q: query,
      videoEmbeddable: "true",
      safeSearch: "moderate",
      key: apiKey,
    });

    const youtubeResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params}`
    );

    if (!youtubeResponse.ok) {
      const text = await youtubeResponse.text();

      return jsonResponse(
        {
          error: "YouTube API respondió con error.",
          details: text,
        },
        youtubeResponse.status
      );
    }

    const data = await youtubeResponse.json();

    const results: YoutubeVideoResult[] = (data.items || [])
      .map((item: any) => {
        const youtubeId = item?.id?.videoId || "";
        const snippet = item?.snippet || {};

        const thumbnail =
          snippet?.thumbnails?.medium?.url ||
          snippet?.thumbnails?.default?.url ||
          "";

        return {
          youtube_id: youtubeId,
          original_youtube_id: null,
          title: snippet.title || "Karaoke sin título",
          channel_title: snippet.channelTitle || "YouTube",
          thumbnail,
          url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : "",
          local_video_url: "",
          search_query: query,
          normalized_query: query,
          is_karaoke: true,
          blocked: false,
          source: "youtube-api",
          play_count: 0,
          requested_count: 0,
          last_used_at: null,
          created_at: new Date().toISOString(),
        };
      })
      .filter((video: YoutubeVideoResult) => {
        return Boolean(video.youtube_id) && looksLikeKaraoke(video);
      })
      .sort((a: YoutubeVideoResult, b: YoutubeVideoResult) => {
        return scoreVideo(b) - scoreVideo(a);
      })
      .slice(0, 6);

    return jsonResponse({
      results,
      cached: false,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Error inesperado en youtube-search.";

    return jsonResponse(
      {
        error: message,
      },
      500
    );
  }
});
