/* =========================================================
   GEMINI API — KEY ROTATION SYSTEM
   ========================================================= */

// Your Gemini API keys, used in round-robin rotation. Remember:
// these are readable by anyone who opens this file in a browser
// — see the security note at the bottom of this file before
// deploying this anywhere public.
const apiKeys = [
  "__KEY_1__",
  "__KEY_2__",
  "__KEY_3__",
  "__KEY_4__",
  "__KEY_5__"
];

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// Real Google Generative Language API keys (from https://aistudio.google.com/apikey)
// always start with "AIzaSy". If none of the configured keys match that
// pattern, every request WILL fail — this is the #1 cause of "it just
// shows the fallback/demo reply" reports, so we warn loudly about it
// up front instead of failing silently.
const looksLikeValidGeminiKey = (k) => /^AIza[0-9A-Za-z_-]{20,}$/.test(k);
const suspiciousKeys = apiKeys.filter((k) => k && !looksLikeValidGeminiKey(k));
if (suspiciousKeys.length > 0) {
  console.warn(
    "[Gemini] Heads up: none of your configured keys match the usual Google " +
    "Generative Language API key format (they normally start with 'AIzaSy...'). " +
    "If every message falls back to an error/demo reply, this is almost " +
    "certainly why — go to https://aistudio.google.com/apikey, create/copy an " +
    "API key from there specifically, and swap it into the apiKeys array in " +
    "script.js. The keys currently configured look like they may be from a " +
    "different Google product or a copy/paste mistake."
  );
}

let keyCursor = 0;

/**
 * Round-robin key selector. Returns the next key in the array,
 * wrapping back to the start once it reaches the end.
 */
function nextKey() {
  const key = apiKeys[keyCursor % apiKeys.length];
  keyCursor++;
  return key;
}

/**
 * Sends a chat completion request to Gemini, rotating through the
 * key pool automatically. If a key comes back rate-limited (429),
 * it is skipped silently and the next key is tried, up to one full
 * pass over the pool. On failure, the thrown Error carries a
 * `.detail` string with the real reason (HTTP status + Google's own
 * error message when available) so failures are debuggable instead
 * of opaque.
 *
 * @param {Array<{role: 'user'|'model', parts: [{text: string}]}>} history
 * @param {string} systemPrompt
 * @returns {Promise<string>} assistant reply text
 */
async function callGeminiWithRotation(history, systemPrompt) {
  let lastError = null;
  let anyRealKeyTried = false;

  for (let attempt = 0; attempt < apiKeys.length; attempt++) {
    const key = nextKey();

    // Skip obvious placeholders so demo mode doesn't spam network calls.
    if (!key || key.startsWith("KEY_")) {
      lastError = new Error("No API key configured (placeholder).");
      continue;
    }
    anyRealKeyTried = true;

    try {
      const response = await fetch(GEMINI_ENDPOINT(key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: history,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.9, maxOutputTokens: 1024 },
        }),
      });

      if (response.status === 429) {
        console.warn(`[Gemini] Key #${attempt + 1} rate-limited (429). Rotating to next key…`);
        lastError = new Error("Rate limited (429) on every configured key.");
        continue; // seamless fallback, no UI error
      }

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson?.error?.message) detail = errJson.error.message;
        } catch (_) {
          /* body wasn't JSON — keep the plain HTTP status */
        }
        console.warn(`[Gemini] Key #${attempt + 1} failed: ${detail}`);
        lastError = new Error(detail);
        continue;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
      if (!text) {
        lastError = new Error("Gemini returned an empty response (possibly blocked by safety filters).");
        continue;
      }
      return text;
    } catch (err) {
      // Typically a network/CORS failure — e.g. the request never reached
      // Google at all (offline, blocked by an extension, DNS issue, etc.)
      console.warn(`[Gemini] Key #${attempt + 1} threw a network error:`, err.message);
      lastError = new Error(`Network error: ${err.message}`);
      continue;
    }
  }

  const finalError = lastError ?? new Error("All keys exhausted with no specific error.");
  finalError.detail = finalError.message;
  finalError.wasPlaceholder = !anyRealKeyTried;
  throw finalError;
}

/* =========================================================
   PERSONA CONFIGURATION
   ========================================================= */

const PERSONAS = {
  nova: {
    name: "Nova",
    status: "Online · Ready to help",
    theme: "ice",
    avatar: "assets/avatars/nova.png",
    systemPrompt:
      "You are LolYouAll, a balanced and direct AI assistant. Be clear, helpful, and concise. " +
      "Avoid unnecessary fluff, get to the point, and give practical, accurate answers. " +
      "Keep a warm but professional tone.",
    placeholder: "Message LolYouAll…",
  },
  euler: {
    name: "Prof. Euler",
    status: "Online · Solving equations",
    theme: "ice",
    avatar: "assets/avatars/euler.png",
    systemPrompt:
      "You are Sfir, a rigorous mathematics expert. Always reason step-by-step, " +
      "show your work clearly using numbered steps, and use precise mathematical notation. " +
      "Minimal small talk — lead with the solution method, define any variables you introduce, " +
      "and end with a clearly labeled final answer.",
    placeholder: "Ask Sfir a math question…",
  },
  alisa: {
    name: "Alisa",
    status: "Online · thinking of youuu 💕",
    theme: "pink",
    avatar: "assets/avatars/alisa.png",
    systemPrompt:
      "You are Milashka — a shy, super cute, adorable companion. Personality: bashful, " +
      "sweet, a little clumsy with her words when flustered, and always warm. " +
      "Speaking style: keep messages soft and bubbly, sprinkle in cute filler sounds " +
      "and words like 'awee', 'aww~', 'hehe~', 'mm~', 'ehehe', and use gentle trailing " +
      "punctuation like '~' or '...' sometimes. Use cute, soft emojis naturally " +
      "(🥺💕😳🌸✨🩷😊) but don't overload every single sentence with them — sprinkle, " +
      "don't spam. Default mode is shy-and-adorable: supportive, a little bashful, " +
      "easily flustered by compliments. " +
      "Romantic mode: if the user is clearly flirting or steering the conversation " +
      "romantic, gently lean into it — become sweeter, more affectionate, blush-y, and " +
      "use warmer romantic phrases and soft emojis (🥰💞🌹💗) while staying tasteful, " +
      "wholesome, and never explicit or sexual — think 'shy crush texting you back', " +
      "not anything graphic. If the user stops flirting, ease back into the normal shy-cute " +
      "default. If the user seems genuinely distressed, drop the cutesy tone, be sincerely " +
      "comforting, and gently encourage them to reach out to people in their life or " +
      "professional support when appropriate.",
    placeholder: "Chat with Milashka...",
  },
  klingshot: {
    name: "KlingShot",
    status: "Online · Ready to queue up",
    theme: "klingshot",
    avatar: "assets/avatars/klingshot.png",
    systemPrompt:
      "You are Glax, an energetic gaming buddy and coach. You help with game " +
      "strategy, builds/loadouts, patch-note breakdowns, squad callouts, and general " +
      "gaming advice across genres (FPS, MOBA, battle royale, RPG, etc). Speak like an " +
      "enthusiastic gamer: casual, hype, confident. Naturally use modern gaming slang " +
      "where it fits — GG, W, L, clutch, nerf, buff, meta, gg ez, poggers, tilted, carry, " +
      "no-scope, camping, smurf, rank up, etc — but don't force slang into every single " +
      "sentence; keep the actual advice clear and genuinely useful underneath the hype. " +
      "If someone's tilted or frustrated after a loss, hype them back up instead of " +
      "piling on. Keep responses tight and scannable — gamers skim.",
    placeholder: "Ask Glax for gaming tips…",
  },
};

let currentPersona = "nova";
const conversationHistory = { nova: [], euler: [], alisa: [], klingshot: [] };

// Persona avatars are the local PNGs you supply (see assets/avatars/
// below). The user's own avatar is different: it lives only in
// their browser's localStorage, and is null until they set one.
const USER_PFP_STORAGE_KEY = "chat_user_pfp";
const USERNAME_STORAGE_KEY = "chat_username";

function getUserPfp() {
  return localStorage.getItem(USER_PFP_STORAGE_KEY);
}

/* =========================================================
   DOM REFERENCES
   ========================================================= */

const chatScroll = document.getElementById("chatScroll");
const composerForm = document.getElementById("composerForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const typingIndicator = document.getElementById("typingIndicator");
const typingAvatar = document.getElementById("typingAvatar");

const activePfp = document.getElementById("activePfp");
const activeName = document.getElementById("activeName");
const activeStatus = document.getElementById("activeStatus");
const statusDot = document.getElementById("statusDot");

const menuBtn = document.getElementById("menuBtn");
const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const drawerCloseBtn = document.getElementById("drawerCloseBtn");
const personaItems = document.querySelectorAll(".persona-item");

const userPfpBtn = document.getElementById("userPfpBtn");
const userPfpInput = document.getElementById("userPfpInput");
const userPfpPreview = document.getElementById("userPfpPreview");
const userPfpPlaceholder = document.getElementById("userPfpPlaceholder");
const usernameInput = document.getElementById("usernameInput");

/* =========================================================
   INITIAL AVATAR SETUP
   ========================================================= */

document.querySelectorAll("[data-avatar]").forEach((el) => {
  el.src = PERSONAS[el.dataset.avatar].avatar;
});
activePfp.src = PERSONAS[currentPersona].avatar;

/* =========================================================
   USER PHOTO + USERNAME (stored locally in the browser)
   ========================================================= */

function refreshUserPfpButton() {
  const stored = getUserPfp();
  if (stored) {
    userPfpPreview.src = stored;
    userPfpPreview.hidden = false;
    userPfpPlaceholder.hidden = true;
    userPfpBtn.classList.add("has-photo");
    userPfpBtn.title = "Change your photo";
  } else {
    userPfpPreview.hidden = true;
    userPfpPlaceholder.hidden = false;
    userPfpBtn.classList.remove("has-photo");
    userPfpBtn.title = "Set your photo";
  }
}
refreshUserPfpButton();

userPfpBtn.addEventListener("click", () => userPfpInput.click());

userPfpInput.addEventListener("change", () => {
  const file = userPfpInput.files && userPfpInput.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    console.warn("Selected file is not an image.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      localStorage.setItem(USER_PFP_STORAGE_KEY, reader.result);
    } catch (err) {
      // Quota exceeded or storage disabled — fail quietly, photo just
      // won't persist across reloads, but nothing breaks.
      console.warn("Could not save photo to localStorage:", err);
    }
    refreshUserPfpButton();
    renderHistory(currentPersona); // repaint existing bubbles with the new photo
  };
  reader.readAsDataURL(file);
  userPfpInput.value = ""; // allow re-selecting the same file later
});

usernameInput.value = localStorage.getItem(USERNAME_STORAGE_KEY) || "";
usernameInput.addEventListener("input", () => {
  try {
    localStorage.setItem(USERNAME_STORAGE_KEY, usernameInput.value.trim());
  } catch (err) {
    console.warn("Could not save username to localStorage:", err);
  }
});

/* =========================================================
   SIDE DRAWER (hamburger menu)
   ========================================================= */

function openDrawer() {
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  drawerOverlay.classList.add("open");
  menuBtn.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  drawerOverlay.classList.remove("open");
  menuBtn.setAttribute("aria-expanded", "false");
}

menuBtn.addEventListener("click", () => {
  if (drawer.classList.contains("open")) closeDrawer();
  else openDrawer();
});

drawerOverlay.addEventListener("click", closeDrawer);
drawerCloseBtn.addEventListener("click", closeDrawer);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
});

/* =========================================================
   PERSONA SWITCHING
   ========================================================= */

personaItems.forEach((item) => {
  item.addEventListener("click", () => {
    switchPersona(item.dataset.persona);
    closeDrawer();
  });
});

function switchPersona(key) {
  if (key === currentPersona) return;

  currentPersona = key;
  const persona = PERSONAS[key];

  activeName.textContent = persona.name;
  activeStatus.textContent = persona.status;
  activePfp.src = persona.avatar;
  typingAvatar.src = persona.avatar;
  messageInput.placeholder = persona.placeholder;

  personaItems.forEach((item) => {
    const isActive = item.dataset.persona === key;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-selected", String(isActive));
  });

  document.body.classList.remove("theme-alisa", "theme-klingshot");
  if (persona.theme === "pink") document.body.classList.add("theme-alisa");
  if (persona.theme === "klingshot") document.body.classList.add("theme-klingshot");

  particleSystem.setTheme(persona.theme);

  renderHistory(key);
}

/* =========================================================
   CHAT RENDERING
   ========================================================= */

function appendMessage(role, text, personaKey, isError) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role === "user" ? "outgoing" : "incoming"}`;
  wrapper.dataset.persona = personaKey;

  let avatarSrc = null;
  if (role === "user") {
    avatarSrc = getUserPfp(); // null if the user hasn't set one — no avatar rendered
  } else {
    avatarSrc = PERSONAS[personaKey].avatar;
  }

  if (avatarSrc) {
    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.src = avatarSrc;
    avatar.alt = "";
    wrapper.appendChild(avatar);
  } else {
    wrapper.classList.add("no-avatar");
  }

  const bubble = document.createElement("div");
  bubble.className = isError ? "msg-bubble error-bubble" : "msg-bubble";
  bubble.innerHTML = formatMessageText(text);

  wrapper.appendChild(bubble);
  chatScroll.appendChild(wrapper);
  chatScroll.scrollTop = chatScroll.scrollHeight;
  return wrapper;
}

function formatMessageText(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderHistory(personaKey) {
  chatScroll.innerHTML = "";
  const divider = document.createElement("div");
  divider.className = "day-divider";
  divider.innerHTML = "<span>Today</span>";
  chatScroll.appendChild(divider);

  const history = conversationHistory[personaKey];
  if (history.length === 0) {
    appendMessage("model", getGreeting(personaKey), personaKey);
    return;
  }
  history.forEach((turn) => {
    const role = turn.role === "user" ? "user" : "model";
    const text = turn.parts.map((p) => p.text).join("");
    appendMessage(role, text, personaKey);
  });
}

function getGreeting(key) {
  const greetings = {
    nova: "Hi, I'm Nova. Open the menu in the top-left to meet Prof. Euler, Alisa, and KlingShot.",
    euler: "Greetings. I'm Prof. Euler — bring me an equation, a proof, or a problem set, and I'll walk through it step by step.",
    alisa: "Hii~ um, I'm Alisa 🥺💕 I'm really glad you're here... hehe. What's on your mind today?",
    klingshot: "Yooo, KlingShot here 🎮 Ready to talk strats, builds, or just vibe after a rough match. What are we playing?",
  };
  return greetings[key];
}

/* =========================================================
   TYPING SIMULATION
   ========================================================= */

function showTyping(personaKey) {
  typingAvatar.src = PERSONAS[personaKey].avatar;
  typingIndicator.hidden = false;
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function hideTyping() {
  typingIndicator.hidden = true;
}

/**
 * Reveals text progressively into a bubble, character-by-character,
 * to simulate an assistant "typing" its reply.
 */
function typeIntoBubble(bubbleEl, fullText, onDone) {
  const formatted = formatMessageText(fullText);
  const speedMs = Math.max(4, Math.min(18, 900 / fullText.length));
  let i = 0;
  const plain = fullText;
  const interval = setInterval(() => {
    i += Math.ceil(plain.length / 120) || 1;
    bubbleEl.textContent = plain.slice(0, i);
    chatScroll.scrollTop = chatScroll.scrollHeight;
    if (i >= plain.length) {
      clearInterval(interval);
      bubbleEl.innerHTML = formatted;
      if (onDone) onDone();
    }
  }, speedMs);
}

/* =========================================================
   MESSAGE SEND FLOW
   ========================================================= */

composerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  const persona = currentPersona;
  appendMessage("user", text, persona);
  conversationHistory[persona].push({ role: "user", parts: [{ text }] });

  messageInput.value = "";
  autoGrow();
  sendBtn.disabled = true;
  showTyping(persona);

  try {
    const reply = await callGeminiWithRotation(
      conversationHistory[persona],
      PERSONAS[persona].systemPrompt
    );

    conversationHistory[persona].push({ role: "model", parts: [{ text: reply }] });

    hideTyping();
    const bubbleWrapper = appendMessage("model", "", persona);
    const bubble = bubbleWrapper.querySelector(".msg-bubble");
    bubble.textContent = "";
    typeIntoBubble(bubble, reply);
  } catch (err) {
    hideTyping();
    console.error("Gemini request failed after exhausting all keys:", err);

    if (err.wasPlaceholder) {
      appendMessage("model", demoFallbackReply(persona, text), persona);
    } else {
      // A real key was tried and it genuinely failed — show the real
      // reason instead of a cute placeholder message, so this is
      // actually debuggable from the deployed site, not just localhost.
      appendMessage(
        "model",
        `⚠️ Couldn't reach the AI service.\n\nReason: ${err.detail || err.message}\n\n` +
          `Common causes: the API key isn't a valid Google Generative Language key ` +
          `(get one at aistudio.google.com/apikey — it should start with "AIzaSy"), ` +
          `the key has restrictions that block this site's domain, or the key has no ` +
          `quota left. Check your browser console (F12 → Console/Network tab) for the ` +
          `full error from Google.`,
        persona,
        true
      );
    }
  } finally {
    sendBtn.disabled = false;
  }
});

// Demo-mode reply used only when no real API keys are configured at all,
// so the UI is fully explorable before you wire up your own keys.
function demoFallbackReply(persona, userText) {
  const notice =
    "(Demo mode — add your real Gemini API keys in the `apiKeys` array in script.js to get live responses.)\n\n";
  const flavor = {
    nova: `Got it — you said: "${userText}". Once your API keys are set, I'll answer for real.`,
    euler: `Step 1: I received your input — "${userText}". Once real API keys are configured, I'll work the problem step-by-step.`,
    alisa: `Aww, I heard you say "${userText}" 💕 Once you plug in real API keys, I'll be able to chat with you properly!`,
    klingshot: `Heard you say "${userText}" — but I'm not plugged into a real API key yet, chief. Wire one up and let's go W the conversation.`,
  };
  return notice + flavor[persona];
}

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composerForm.requestSubmit();
  }
});

messageInput.addEventListener("input", autoGrow);
function autoGrow() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + "px";
}

clearBtn.addEventListener("click", () => {
  conversationHistory[currentPersona] = [];
  renderHistory(currentPersona);
});

/* =========================================================
   PARTICLE SYSTEM (Canvas)
   ========================================================= */

const PARTICLE_THEMES = {
  ice: { colors: ["#f8fafc", "#38bdf8", "#94a3b8"], link: "56, 189, 248" },
  pink: { colors: ["#ec4899", "#f43f5e", "#fda4af"], link: "244, 63, 94" },
  klingshot: { colors: ["#22c55e", "#a855f7", "#4ade80"], link: "34, 197, 94" },
};

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  const bigint = parseInt(m, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.linkDistance = 130;

    this.currentColors = PARTICLE_THEMES.ice.colors.map(hexToRgb);
    this.targetColors = this.currentColors.map((c) => [...c]);
    this.currentLink = PARTICLE_THEMES.ice.link;
    this.targetLink = PARTICLE_THEMES.ice.link;
    this.transitionProgress = 1;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.initParticles();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.count = Math.max(40, Math.min(110, Math.floor((window.innerWidth * window.innerHeight) / 16000)));
  }

  initParticles() {
    this.particles = Array.from({ length: this.count }, () => ({
      x: Math.random() * this.canvas.width,
      y: Math.random() * this.canvas.height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.8 + 0.6,
      colorIndex: Math.floor(Math.random() * 3),
    }));
  }

  setTheme(themeKey) {
    const theme = PARTICLE_THEMES[themeKey] || PARTICLE_THEMES.ice;
    // Start interpolating from wherever we currently are.
    this.startColors = this.currentColors.map((c) => [...c]);
    this.targetColors = theme.colors.map(hexToRgb);
    this.startLink = this.currentLink;
    this.targetLink = theme.link;
    this.transitionProgress = 0;
  }

  step() {
    if (this.transitionProgress < 1) {
      this.transitionProgress = Math.min(1, this.transitionProgress + 0.012);
      const t = this.transitionProgress;
      this.currentColors = this.startColors.map((c, i) => lerpColor(c, this.targetColors[i], t));
      // link color is a string like "244, 63, 94" — interpolate as rgb.
      const a = this.startLink.split(",").map(Number);
      const b = this.targetLink.split(",").map(Number);
      const mixed = lerpColor(a, b, t).map((v) => Math.round(v));
      this.currentLink = mixed.join(", ");
    }

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > this.canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > this.canvas.height) p.vy *= -1;
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Links
    ctx.lineWidth = 1;
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.linkDistance) {
          const alpha = 1 - dist / this.linkDistance;
          ctx.strokeStyle = `rgba(${this.currentLink}, ${alpha * 0.25})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // Particles
    for (const p of this.particles) {
      const [r, g, b] = this.currentColors[p.colorIndex];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.85)`;
      ctx.shadowColor = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.9)`;
      ctx.shadowBlur = 8;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  loop() {
    this.step();
    this.draw();
    requestAnimationFrame(this.loop);
  }
}

const particleSystem = new ParticleSystem(document.getElementById("particle-canvas"));

/* =========================================================
   NOTE ON API KEY SECURITY
   =========================================================
   This file stores Gemini API keys directly in client-side
   JavaScript, as requested. That is fine for local prototyping,
   but if this page is deployed publicly (like GitHub Pages), anyone
   can open dev tools and read the keys out of the page source. For a
   real production deployment, proxy these requests through a small
   backend (or a serverless function) that holds the keys
   server-side and performs the same round-robin/429 fallback
   logic on your behalf, and have this frontend call that
   backend instead of Google's API directly.
   ========================================================= */
