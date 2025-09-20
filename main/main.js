import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const electron = require("electron");
const dotenv = require("dotenv");
const dotenvExpand = require("dotenv-expand");
const {
  app,
  BrowserWindow,
  BrowserView,
  nativeTheme,
  nativeImage,
  ipcMain,
  shell,
} = electron;
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

// Load environment variables early (development .env support)
try {
  const envFile =
    process.env.CLEO_ENV_FILE ||
    path.join(process.cwd(), ".env");
  const result = dotenv.config({ path: envFile });
  if (result?.parsed) {
    dotenvExpand(result);
  }
} catch (err) {
  console.warn("[cleo] Falha ao carregar variáveis de ambiente:", err);
}

// App metadata
app.setName("ElekTron");
nativeTheme.themeSource = "dark";

let mainWindow = null;
let mmView = null;
let mmSidebarWidth = 224; // largura padrão da sidebar
const mmURLDefault = "http://localhost:8065";
let chatekHandlersRegistered = false;

const resolveMainWindow = () => {
  if (mainWindow && typeof mainWindow.isDestroyed === "function" && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  const [fallback] = BrowserWindow.getAllWindows();
  if (fallback && typeof fallback.isDestroyed === "function" && !fallback.isDestroyed()) {
    mainWindow = fallback;
    return mainWindow;
  }
  return null;
};

const resolveMmView = () => {
  if (!mmView) return null;
  const wc = mmView.webContents;
  if (wc && typeof wc.isDestroyed === "function" && wc.isDestroyed()) {
    mmView = null;
    return null;
  }
  return mmView;
};

const updateMmBounds = () => {
  const win = resolveMainWindow();
  const view = resolveMmView();
  if (!win || !view) return;
  try {
    const { width, height } = win.getContentBounds();
    const maxSidebar = Math.floor(width * 0.6);
    const x = Math.max(0, Math.min(mmSidebarWidth, maxSidebar));
    view.setBounds({ x, y: 0, width: Math.max(0, width - x), height });
  } catch {}
};

const registerChatekHandlers = () => {
  if (chatekHandlersRegistered) return;
  chatekHandlersRegistered = true;

  ipcMain.handle("chatek:show", async (_e, { url }) => {
    try {
      const win = resolveMainWindow();
      if (!win) throw new Error("Janela principal indisponível");

      let view = resolveMmView();
      if (!view) {
        view = new BrowserView({
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
          },
        });
        view.setAutoResize({ width: true, height: true });
        mmView = view;
      }

      const attached = win.getBrowserViews();
      if (!attached.includes(view)) {
        win.addBrowserView(view);
      }

      await view.webContents.loadURL(url || mmURLDefault);
      updateMmBounds();
      return true;
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  });

  ipcMain.handle("chatek:hide", async () => {
    try {
      const win = resolveMainWindow();
      const view = resolveMmView();
      if (win && view) {
        const attached = win.getBrowserViews();
        if (attached.includes(view)) {
          win.removeBrowserView(view);
        }
      }
    } catch {}
    return true;
  });

  ipcMain.handle("chatek:setSidebarWidth", async (_e, { width }) => {
    if (typeof width === "number" && width >= 0) {
      mmSidebarWidth = width;
    }
    updateMmBounds();
    return true;
  });
};

function createWindow() {
  const appPath = app.getAppPath();
  const pngIconPath = path.join(process.cwd(), "assets", "icon.png");
  let icon;
  if (fs.existsSync(pngIconPath)) {
    icon = nativeImage.createFromPath(pngIconPath);
  }

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    resizable: true,
    backgroundColor: "#0b0f14",
    title: "ElekTron",
    icon: icon || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      preload: path.join(appPath, "main", "preload.cjs"),
    },
  });

  mainWindow = win;
  registerChatekHandlers();

  win.loadFile(path.join(appPath, "renderer", "index.html"));

  win.on("resize", updateMmBounds);
  win.on("move", updateMmBounds);
  win.on("close", () => {
    const view = resolveMmView();
    if (!view) return;
    try {
      const attached = win.getBrowserViews();
      if (attached.includes(view)) {
        win.removeBrowserView(view);
      }
    } catch {}
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
    const view = resolveMmView();
    if (view) {
      try {
        view.destroy?.();
      } catch {}
    }
    mmView = null;
  });

  // Abrir links externos (target=_blank ou navegação externa) no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:/i.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url && !url.startsWith("file://") && /^https?:/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

const collectOutputFiles = async (dir, max = 200) => {
  const collected = [];
  const walk = async (current, prefix = "") => {
    if (collected.length >= max) return;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (collected.length >= max) break;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, rel);
      } else if (entry.isFile()) {
        collected.push(rel);
      }
    }
  };
  await walk(dir);
  return collected;
};

ipcMain.handle("openai:ffmpeg-command", async (_evt, payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload inválido");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY não configurada. Adicione sua chave ao arquivo .env (OPENAI_API_KEY=...)."
    );
  }
  const model = "gpt-4o-mini";
  const { prompt, video } = payload;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Prompt vazio.");
  }
  const videoLabel =
    video && typeof video === "object"
      ? `${video.name || "vídeo desconhecido"} (${
          video.mime || "mime desconhecido"
        }, ${
          video.size
            ? `${(video.size / (1024 * 1024)).toFixed(2)} MB`
            : "tamanho desconhecido"
        })`
      : "vídeo não informado";

  const systemPrompt = `Você converte pedidos em argumentos para o executável ffmpeg.
Regras:
- Responda somente com JSON válido.
- Estrutura: {"args": ["-i", "{{input}}", ...], "description": "...", "outputs": [{"relativePath": "subpasta/arquivo.ext", "description": "..."}]}
- Use {{input}} para o caminho absoluto do vídeo de entrada e {{outputDir}} para o diretório de saída.
- Ao referenciar arquivos nas opções do ffmpeg, use {{outputDir}}/subpasta/arquivo.ext.
- Liste os mesmos caminhos relativos em outputs[].
- Não inclua pipes, redirecionamentos, && ou outros comandos.
- Caso não seja possível atender ao pedido com ffmpeg, deixe args vazio e explique no description.`;

  const userPrompt = `Vídeo: ${videoLabel}
Pedido: ${prompt.trim()}
Gere apenas argumentos ffmpeg seguindo as regras.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Resposta vazia da API do ChatGPT.");

  const parseJson = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/```json\s*([\s\S]+?)\s*```/i);
      if (match) {
        return JSON.parse(match[1]);
      }
      throw new Error("Não foi possível interpretar a resposta do ChatGPT.");
    }
  };

  const parsed = parseJson(content);
  if (!parsed || !Array.isArray(parsed.args)) {
    throw new Error("Resposta do ChatGPT sem args válidos.");
  }
  parsed.args = parsed.args.map((arg) => String(arg));
  if (parsed.outputs && Array.isArray(parsed.outputs)) {
    parsed.outputs = parsed.outputs
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const rel =
          typeof item.relativePath === "string" ? item.relativePath : null;
        if (!rel) return null;
        return {
          relativePath: rel,
          description:
            typeof item.description === "string" ? item.description : "",
        };
      })
      .filter(Boolean);
  } else {
    parsed.outputs = [];
  }
  parsed.description =
    typeof parsed.description === "string" ? parsed.description : "";
  return parsed;
});

ipcMain.handle("ffmpeg:process", async (_evt, payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload inválido");
  }
  if (!app.isReady()) {
    await app.whenReady();
  }
  const { name, dataBase64, mime, size, commandPlan } = payload;
  if (!dataBase64 || typeof dataBase64 !== "string") {
    throw new Error("Arquivo de vídeo ausente");
  }
  const safeName = (name || "video").replace(/[^a-zA-Z0-9._-]/g, "_");
  let downloadsRoot;
  try {
    downloadsRoot = app.getPath("downloads");
  } catch {}
  const baseDir = downloadsRoot
    ? path.join(downloadsRoot, "ElekTron", "ffmpeg-jobs")
    : path.join(app.getPath("userData"), "ffmpeg-jobs");
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jobDir = path.join(baseDir, jobId);
  const inputDir = path.join(jobDir, "input");
  const outputDir = path.join(jobDir, "output");
  await fsp.mkdir(inputDir, { recursive: true });
  await fsp.mkdir(outputDir, { recursive: true });
  const inputPath = path.join(inputDir, safeName);
  const buffer = Buffer.from(dataBase64, "base64");
  await fsp.writeFile(inputPath, buffer);

  const ffmpegCmd =
    (typeof payload?.ffmpegPath === "string" && payload.ffmpegPath.trim()) ||
    process.env.FFMPEG_PATH ||
    "ffmpeg";

  const replacePlaceholders = (value) =>
    value.replace(/{{input}}/g, inputPath).replace(/{{outputDir}}/g, outputDir);

  let resolvedArgs;
  let mode = "scene-detect";
  let description = "";
  let sceneThreshold = null;
  const outputsMeta = Array.isArray(commandPlan?.outputs)
    ? commandPlan.outputs
    : [];

  if (
    commandPlan &&
    Array.isArray(commandPlan.args) &&
    commandPlan.args.length
  ) {
    mode = "custom";
    description =
      typeof commandPlan.description === "string"
        ? commandPlan.description
        : "";
    resolvedArgs = commandPlan.args.map((arg) =>
      replacePlaceholders(String(arg))
    );
    for (const outItem of outputsMeta) {
      if (!outItem || typeof outItem !== "object") continue;
      const rel =
        typeof outItem.relativePath === "string" ? outItem.relativePath : null;
      if (!rel) continue;
      const dirName = path.dirname(rel);
      if (dirName && dirName !== ".") {
        await fsp.mkdir(path.join(outputDir, dirName), { recursive: true });
      }
    }
  } else {
    mode = "scene-detect";
    const requestedThreshold =
      typeof payload?.sceneThreshold === "number"
        ? payload.sceneThreshold
        : undefined;
    sceneThreshold = requestedThreshold ?? 0.1;
    const outputPattern = path.join(outputDir, "frame_%04d.png");
    const vfArg = `select='gt(scene,${sceneThreshold})',showinfo`;
    resolvedArgs = [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-vf",
      vfArg,
      "-vsync",
      "vfr",
      outputPattern,
    ];
    if (!description)
      description = `Extração de frames por cena (limiar ${sceneThreshold}).`;
    if (!description)
      description = `Extração de frames por cena (limiar ${sceneThreshold}).`;
  }

  const startedAt = new Date().toISOString();

  await new Promise((resolve, reject) => {
    const ff = spawn(ffmpegCmd, resolvedArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    ff.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    ff.on("error", (err) => {
      if (err?.code === "ENOENT") {
        reject(
          new Error(
            `FFmpeg não encontrado (comando '${ffmpegCmd}'). Instale o FFmpeg ou defina a variável de ambiente FFMPEG_PATH com o caminho do executável.`
          )
        );
        return;
      }
      reject(new Error(`Falha ao iniciar FFmpeg: ${err?.message || err}`));
    });
    ff.on("close", (code) => {
      if (code === 0) resolve(null);
      else reject(new Error(stderr || `FFmpeg retornou código ${code}`));
    });
  });

  const outputs = await collectOutputFiles(outputDir);
  const outputDirUrl = pathToFileURL(outputDir).toString();
  const finishedAt = new Date().toISOString();

  const result = {
    mode,
    videoName: name,
    videoMime: mime,
    videoSize: size,
    outputDir,
    outputDirUrl,
    outputs,
    args: resolvedArgs,
    command: [ffmpegCmd, ...resolvedArgs].join(" "),
    description,
    startedAt,
    finishedAt,
    requestedOutputs: outputsMeta,
    ffmpegPath: ffmpegCmd,
  };

  if (mode === "scene-detect") {
    result.sceneThreshold = sceneThreshold;
    const frames = outputs.filter((file) =>
      file.toLowerCase().match(/\.(png|jpe?g)$/)
    );
    result.frames = frames;
    result.frameCount = frames.length;
  }

  return result;
});

app.whenReady().then(() => {
  const readConfig = () => {
    try {
      const p = path.join(app.getAppPath(), "assets", "config.json");
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return {};
    }
  };

  const requestOnce = async (url, payload, headers = {}, method = "POST") => {
    const init = { method, headers: { ...headers } };
    let finalUrl = url;

    if (method === "POST") {
      init.headers["Content-Type"] =
        init.headers["Content-Type"] || "application/json";
      init.body = JSON.stringify(payload);
    }

    const res = await fetch(finalUrl, init);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: res.ok, status: res.status, body: text };
    }

    return { res, text, data, url: finalUrl, method };
  };

  const formatError = (message, attempts) => {
    const last = (message || "").toString();
    const snippet = last.length > 240 ? `${last.slice(0, 240)}…` : last;
    const seq = attempts
      .map((a) => `${a.method} ${a.url} → ${a.status}`)
      .join(" | ");
    return `${snippet} [tentativas: ${seq}]`;
  };

  const callWebhook = async (url, payload, headers = {}, forcedMethod) => {
    if (!url) throw new Error("Webhook URL não configurado");
    const configuredMethod = (
      forcedMethod ||
      readConfig().n8nMethod ||
      "POST"
    ).toUpperCase();
    const attempts = [];

    const first = await requestOnce(url, payload, headers, configuredMethod);
    attempts.push({
      url: first.url,
      method: first.method,
      status: first.res.status,
    });

    let { res, data, text } = first;
    if (res.ok) return data;

    const msg = (data?.message || text || "").toLowerCase();
    const notRegistered =
      msg.includes("webhook") &&
      msg.includes("not") &&
      msg.includes("registered");

    if (res.status === 404 || notRegistered) {
      const variants = new Set();
      const envSwap = url.includes("/webhook-test/")
        ? url.replace("/webhook-test/", "/webhook/")
        : url.replace("/webhook/", "/webhook-test/");
      const toggleSlash = (u) => (u.endsWith("/") ? u.slice(0, -1) : `${u}/`);
      [url, envSwap].forEach((base) => {
        variants.add(base);
        variants.add(toggleSlash(base));
      });
      variants.delete(url);

      for (const v of variants) {
        const retry = await requestOnce(v, payload, headers, configuredMethod);
        attempts.push({
          url: retry.url,
          method: retry.method,
          status: retry.res.status,
        });
        if (retry.res.ok) return retry.data;
      }
    }

    throw new Error(
      formatError(data?.message || `Erro ${res.status}`, attempts)
    );
  };

  const EVENT_DELETE_TOKENS = new Set([
    "delete",
    "deleted",
    "remove",
    "removed",
    "cancel",
    "cancelled",
    "canceled",
  ]);
  const firstString = (...vals) => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const coerceDateTime = (val) => {
    if (!val) return "";
    if (typeof val === "string") return val.trim();
    if (typeof val === "object") {
      if (typeof val.dateTime === "string") return val.dateTime.trim();
      if (typeof val.datetime === "string") return val.datetime.trim();
      if (typeof val.date_time === "string") return val.date_time.trim();
      if (typeof val.date === "string") return val.date.trim();
      if (typeof val.value === "string") return val.value.trim();
    }
    return "";
  };
  const firstDateTime = (...vals) => {
    for (const v of vals) {
      const dv = coerceDateTime(v);
      if (dv) return dv;
    }
    return "";
  };
  const computeEventKey = (info = {}) => {
    const id = firstString(
      info.id,
      info.eventId,
      info.event_id,
      info.uid,
      info.iCalUID,
      info.icalUID,
      info.icalUid,
      info.key,
      info.link,
      info.htmlLink,
      info.hangoutLink,
      info.conferenceUri,
      info.conferenceURL,
      info.conferenceUrl
    );
    if (id) return id;
    const start = firstString(info.start, info.startDate, info.startTime);
    if (start) {
      const summary = firstString(info.summary, info.title, info.name);
      if (summary) return `${start}|${summary}`.toLowerCase();
      return start.toLowerCase();
    }
    return null;
  };
  const collectEventCandidates = (root) => {
    const out = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);
      const looksEvent =
        node.summary ||
        node.title ||
        node.start ||
        node.end ||
        node.id ||
        node.event ||
        node.data ||
        node.changeType ||
        node.operationType;
      if (looksEvent) out.push(node);
      if (node.event) visit(node.event);
      if (node.data) visit(node.data);
      if (node.events) visit(node.events);
      if (node.items) visit(node.items);
      if (node.payload) visit(node.payload);
    };
    visit(root);
    return out;
  };
  const normalizeWebhookEvent = (raw, fallback = {}) => {
    if (!raw || typeof raw !== "object") return null;
    const base = raw;
    const dataObj =
      base.data && typeof base.data === "object" ? base.data : null;
    const nested =
      dataObj && typeof dataObj.event === "object" ? dataObj.event : null;
    const eventObj =
      base.event && typeof base.event === "object" ? base.event : null;
    const fallbackObj =
      fallback && typeof fallback === "object" ? fallback : {};
    const start = firstDateTime(
      base.start,
      base.startDate,
      base.startTime,
      base.start?.dateTime,
      base.start?.date,
      eventObj?.start,
      eventObj?.start?.dateTime,
      eventObj?.start?.date,
      dataObj?.start,
      dataObj?.start?.dateTime,
      dataObj?.start?.date,
      nested?.start,
      nested?.start?.dateTime,
      nested?.start?.date,
      fallbackObj.start,
      fallbackObj.date,
      fallbackObj.dateTime
    );
    const end = firstDateTime(
      base.end,
      base.endDate,
      base.endTime,
      base.end?.dateTime,
      base.end?.date,
      eventObj?.end,
      eventObj?.end?.dateTime,
      eventObj?.end?.date,
      dataObj?.end,
      dataObj?.end?.dateTime,
      dataObj?.end?.date,
      nested?.end,
      nested?.end?.dateTime,
      nested?.end?.date
    );
    const summary = firstString(
      base.summary,
      base.title,
      eventObj?.summary,
      eventObj?.title,
      dataObj?.summary,
      dataObj?.title,
      nested?.summary,
      nested?.title,
      fallbackObj.summary,
      fallbackObj.title,
      fallbackObj.name
    );
    const description = firstString(
      base.description,
      eventObj?.description,
      dataObj?.description,
      nested?.description,
      base.details,
      dataObj?.details,
      fallbackObj.description
    );
    const durationMinutesRaw =
      base.durationMinutes ??
      eventObj?.durationMinutes ??
      dataObj?.durationMinutes ??
      nested?.durationMinutes ??
      fallbackObj.durationMinutes;
    const durationMinutes =
      typeof durationMinutesRaw === "number"
        ? durationMinutesRaw
        : parseInt(
            typeof durationMinutesRaw === "string" ? durationMinutesRaw : "",
            10
          );
    const timeZone = firstString(
      base.timeZone,
      eventObj?.timeZone,
      dataObj?.timeZone,
      nested?.timeZone,
      base.start?.timeZone,
      eventObj?.start?.timeZone,
      dataObj?.start?.timeZone,
      fallbackObj.timeZone
    );
    const link = firstString(
      base.link,
      base.htmlLink,
      base.hangoutLink,
      base.meetingLink,
      eventObj?.link,
      eventObj?.htmlLink,
      eventObj?.hangoutLink,
      dataObj?.link,
      dataObj?.htmlLink,
      dataObj?.hangoutLink,
      nested?.link,
      nested?.htmlLink,
      nested?.hangoutLink,
      base?.conferenceData?.entryPoints?.[0]?.uri,
      eventObj?.conferenceData?.entryPoints?.[0]?.uri,
      dataObj?.conferenceData?.entryPoints?.[0]?.uri,
      fallbackObj.link
    );
    const hangoutLink = firstString(
      base.hangoutLink,
      eventObj?.hangoutLink,
      dataObj?.hangoutLink,
      nested?.hangoutLink
    );
    const id = firstString(
      base.id,
      base.eventId,
      base.event_id,
      base.iCalUID,
      base.icalUID,
      base.uid,
      eventObj?.id,
      eventObj?.eventId,
      eventObj?.iCalUID,
      dataObj?.id,
      dataObj?.eventId,
      dataObj?.iCalUID,
      nested?.id,
      nested?.eventId,
      nested?.iCalUID,
      fallbackObj.id
    );
    const statusRaw = firstString(
      base.status,
      base.eventStatus,
      base.lifecycleState,
      eventObj?.status,
      dataObj?.status,
      nested?.status
    );
    const actionRaw = firstString(
      base.action,
      base.changeType,
      base.operationType,
      base.lifecycleState,
      eventObj?.action,
      dataObj?.action,
      nested?.action
    );
    const statusNormalized = statusRaw ? statusRaw.toLowerCase() : "";
    const actionNormalized = actionRaw ? actionRaw.toLowerCase() : "";
    const typeNormalized = firstString(
      base.type,
      eventObj?.type,
      dataObj?.type
    ).toLowerCase();
    const deletionFlag = [
      base.deleted,
      base.cancelled,
      base.canceled,
      base.removed,
      base.isDeleted,
      base.isRemoved,
      eventObj?.deleted,
      eventObj?.cancelled,
      eventObj?.canceled,
      eventObj?.removed,
      dataObj?.deleted,
      dataObj?.cancelled,
      dataObj?.canceled,
      dataObj?.removed,
      nested?.deleted,
      nested?.cancelled,
      nested?.canceled,
      nested?.removed,
      base?.status === false,
    ].some((v) => v === true);
    const isDeletion =
      deletionFlag ||
      EVENT_DELETE_TOKENS.has(statusNormalized) ||
      EVENT_DELETE_TOKENS.has(actionNormalized) ||
      typeNormalized.includes("delete") ||
      typeNormalized.includes("cancel");
    const key = computeEventKey({
      id,
      eventId: base.eventId,
      start: start || fallbackObj.start || fallbackObj.dateTime,
      startDate: base.startDate,
      startTime: base.startTime,
      summary,
      title: base.title || fallbackObj.title,
      link,
      htmlLink: base.htmlLink,
      hangoutLink,
      uid: base.uid,
      iCalUID: base.iCalUID,
    });
    if (!key) return null;
    const event = {
      type: "event",
      id: id || undefined,
      key,
      start: start || undefined,
      end: end || undefined,
      summary: summary || undefined,
      title: summary || undefined,
      description: description || undefined,
      durationMinutes: Number.isFinite(durationMinutes)
        ? durationMinutes
        : undefined,
      timeZone: timeZone || undefined,
      link: link || hangoutLink || undefined,
      hangoutLink: hangoutLink || undefined,
      status: statusNormalized || undefined,
      action: actionNormalized || undefined,
    };
    return { key, event, isDeletion };
  };

  // Chat history persistence
  const historyFile = () => {
    try {
      return path.join(app.getPath("userData"), "chat-history.json");
    } catch {
      return path.join(process.cwd(), "chat-history.json");
    }
  };
  const readHistoryObject = async () => {
    try {
      const file = historyFile();
      const raw = await fsp.readFile(file, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        // migrate from array → versioned object
        return { version: 1, items: data };
      }
      if (data && typeof data === "object" && Array.isArray(data.items)) {
        return { version: data.version || 1, items: data.items };
      }
      return { version: 1, items: [] };
    } catch {
      return { version: 1, items: [] };
    }
  };
  const readHistory = async () => (await readHistoryObject()).items;
  const writeHistoryObject = async (obj) => {
    const file = historyFile();
    const dir = path.dirname(file);
    const tmp = `${file}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;
    const bak = `${file}.bak`;
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch {}
    const data = JSON.stringify(obj, null, 2);
    // Escreve em arquivo temporário único, cria backup e troca atômica
    await fsp.writeFile(tmp, data, "utf8");
    try {
      // cria backup do arquivo atual, se existir
      await fsp.copyFile(file, bak).catch(() => {});
    } catch {}
    try {
      await fsp.rename(tmp, file);
    } catch (err) {
      // Se houve corrida e o tmp sumiu, faz write direto como fallback
      if (err && err.code === "ENOENT") {
        await fsp.writeFile(file, data, "utf8");
      } else {
        throw err;
      }
    }
  };
  const appendHistory = async (entry, options = {}) => {
    const { items, version } = await readHistoryObject();
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 500;
    items.push(entry);
    // enforce limit (keep the most recent N)
    const trimmed = items.length > limit ? items.slice(-limit) : items;
    await writeHistoryObject({ version: version || 1, items: trimmed });
    return { ok: true };
  };
  const clearHistory = async () => {
    await writeHistoryObject({ version: 1, items: [] });
    return { ok: true };
  };

  ipcMain.handle("cleo:schedule", async (_evt, arg) => {
    const cfg = readConfig();
    const payload =
      arg && typeof arg === "object" && "payload" in arg ? arg.payload : arg;
    const opts =
      arg && typeof arg === "object" && "options" in arg
        ? arg.options || {}
        : {};
    const url = opts.url || cfg.n8nScheduleWebhook;
    const headers = {
      ...(cfg.n8nHeaders || {}),
      ...(opts.headers || {}),
      "Content-Type": "application/json",
    };
    const method = "POST";

    try {
      // Chama o webhook do n8n
      const result = await callWebhook(url.trim(), payload, headers, method);
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        const candidates = collectEventCandidates(result);
        const dedupe = new Set();
        const normalizedEvents = [];
        candidates.forEach((candidate) => {
          const normalized = normalizeWebhookEvent(candidate, payload);
          if (normalized && normalized.key) {
            const tag = `${normalized.key}|${
              normalized.isDeletion ? "del" : "add"
            }`;
            if (!dedupe.has(tag)) {
              dedupe.add(tag);
              normalizedEvents.push(normalized);
            }
          }
        });

        if (!normalizedEvents.length) {
          win.webContents.send(
            "chat:reply",
            `Resposta do webhook: ${JSON.stringify(result).slice(0, 800)}…`
          );
        } else {
          for (const normalized of normalizedEvents) {
            const evt = normalized.event || {};
            const payloadForRenderer = {
              type: "event",
              summary:
                evt.summary ||
                evt.title ||
                payload?.summary ||
                payload?.title ||
                "",
              description: evt.description || payload?.description || "",
              start: evt.start || payload?.start || payload?.dateTime || "",
              end: evt.end,
              durationMinutes: evt.durationMinutes ?? payload?.durationMinutes,
              timeZone: evt.timeZone || payload?.timeZone,
              link: evt.link,
              id: evt.id,
              key: normalized.key,
              status: evt.status,
              action: evt.action,
              deleted: normalized.isDeletion || undefined,
              origin: "server",
              ack: normalized.isDeletion || undefined,
              chat: "google",
            };
            Object.keys(payloadForRenderer).forEach((k) => {
              if (
                payloadForRenderer[k] === undefined ||
                payloadForRenderer[k] === ""
              ) {
                if (k === "chat" || k === "type") return;
                delete payloadForRenderer[k];
              }
            });
            if (!normalized.isDeletion) delete payloadForRenderer.deleted;
            if (!normalized.isDeletion) delete payloadForRenderer.ack;
            win.webContents.send("chat:reply", payloadForRenderer);
            if (!normalized.isDeletion) {
              try {
                await appendHistory(
                  {
                    role: "assistant",
                    kind: "event",
                    data: payloadForRenderer,
                    ts: Date.now(),
                    chat: "google",
                  },
                  { limit: 500 }
                );
              } catch {}
            }
          }
        }
      }

      return result;
    } catch (err) {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send(
        "chat:reply",
        `Erro ao chamar webhook: ${err?.message || err}`
      );
      throw err;
    }
  });

  ipcMain.handle("cleo:delete-event", async (_evt, arg) => {
    const cfg = readConfig();
    const payload =
      arg && typeof arg === "object" && "payload" in arg ? arg.payload : arg;
    const opts =
      arg && typeof arg === "object" && "options" in arg
        ? arg.options || {}
        : {};
    const url = opts.url || cfg.n8nScheduleWebhook;
    const headers = {
      ...(cfg.n8nHeaders || {}),
      ...(opts.headers || {}),
      "Content-Type": "application/json",
    };
    const method = (
      opts.method ||
      readConfig().n8nMethod ||
      "POST"
    ).toUpperCase();

    try {
      const enrichedPayload = {
        action: "delete",
        ...(payload || {}),
      };
      const result = await callWebhook(
        url.trim(),
        enrichedPayload,
        headers,
        method
      );
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        const candidates = collectEventCandidates(result);
        const dedupe = new Set();
        const normalizedEvents = [];
        candidates.forEach((candidate) => {
          const normalized = normalizeWebhookEvent(
            candidate,
            payload?.event || payload
          );
          if (normalized && normalized.key) {
            const tag = `${normalized.key}|${
              normalized.isDeletion ? "del" : "add"
            }`;
            if (!dedupe.has(tag)) {
              dedupe.add(tag);
              normalizedEvents.push(normalized);
            }
          }
        });

        if (normalizedEvents.length) {
          for (const normalized of normalizedEvents) {
            const evt = normalized.event || {};
            const payloadForRenderer = {
              type: "event",
              summary: evt.summary || evt.title || payload?.summary || "",
              description: evt.description || payload?.description || "",
              start: evt.start || payload?.start || "",
              end: evt.end || payload?.end || "",
              durationMinutes: evt.durationMinutes ?? payload?.durationMinutes,
              timeZone: evt.timeZone || payload?.timeZone,
              link: evt.link || payload?.link,
              id: evt.id || payload?.eventId || payload?.id,
              key: normalized.key,
              status: evt.status,
              action: evt.action,
              deleted: true,
              origin: "server",
              ack: true,
              chat: "google",
            };
            Object.keys(payloadForRenderer).forEach((k) => {
              if (
                payloadForRenderer[k] === undefined ||
                payloadForRenderer[k] === ""
              ) {
                if (
                  k === "chat" ||
                  k === "type" ||
                  k === "deleted" ||
                  k === "ack" ||
                  k === "origin"
                )
                  return;
                delete payloadForRenderer[k];
              }
            });
            win.webContents.send("chat:reply", payloadForRenderer);
          }
        }
      }
      return result;
    } catch (err) {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send(
        "chat:reply",
        `Erro ao deletar evento: ${err?.message || err}`
      );
      throw err;
    }
  });

  ipcMain.handle("cleo:history-load", async () => readHistory());
  ipcMain.handle("cleo:history-path", async () => historyFile());
  ipcMain.handle("cleo:history-append", async (_evt, payload) => {
    if (payload && typeof payload === "object" && "entry" in payload) {
      return appendHistory(payload.entry, payload.options || {});
    }
    return appendHistory(payload);
  });
  ipcMain.handle("cleo:history-clear", async () => clearHistory());

  // Abrir URL no navegador padrão via IPC
  ipcMain.handle("cleo:openExternal", async (_evt, target) => {
    if (typeof target !== "string") return { ok: false };
    const url = target.trim();
    if (!url) return { ok: false };

    if (/^https?:/i.test(url)) {
      await shell.openExternal(url);
      return { ok: true };
    }

    const normalizeFilePath = (raw) => {
      let cleaned = raw;
      if (cleaned.startsWith("file://"))
        cleaned = cleaned.slice("file://".length);
      cleaned = cleaned.replace(/^\/\//, "/");
      try {
        cleaned = decodeURI(cleaned);
      } catch {}
      return cleaned;
    };

    const filePath = normalizeFilePath(url);
    if (!filePath) return { ok: false };
    const result = await shell.openPath(filePath);
    return { ok: !result, error: result || undefined };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
