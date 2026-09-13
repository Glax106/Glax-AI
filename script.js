/* =========================================================
   GEMINI API — KEY ROTATION SYSTEM
   ========================================================= */

// Your Gemini API keys, used in round-robin rotation. Remember:
// these are readable by anyone who opens this file in a browser
// — see the security note at the bottom of this file before
// deploying this anywhere public.
let apiKeys = [];

async function loadApiKeys() {
  try {
    const response = await fetch("https://gist.githubusercontent.com/Glax106/77e2330a015c9600a8a6e94445a1c7fd/raw/fb75b818e917587a79d75ea9592f17288bb18ccf/keys.json");
    apiKeys = await response.json();
  } catch (error) {
    console.error("Error loading keys:", error);
  }
}

loadApiKeys();


const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

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
 * pass over the pool.
 *
 * @param {Array<{role: 'user'|'model', parts: [{text: string}]}>} history
 * @param {string} systemPrompt
 * @returns {Promise<string>} assistant reply text
 */
async function callGeminiWithRotation(history, systemPrompt) {
  let lastError = null;

  for (let attempt = 0; attempt < apiKeys.length; attempt++) {
    const key = nextKey();

    // Skip obvious placeholders so demo mode doesn't spam network calls.
    if (!key || key.startsWith("KEY_")) {
      lastError = new Error("placeholder-key");
      continue;
    }

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
        lastError = new Error("rate-limited");
        continue; // seamless fallback, no UI error
      }

      if (!response.ok) {
        console.warn(`[Gemini] Key #${attempt + 1} failed with status ${response.status}.`);
        lastError = new Error(`http-${response.status}`);
        continue;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
      if (!text) {
        lastError = new Error("empty-response");
        continue;
      }
      return text;
    } catch (err) {
      console.warn(`[Gemini] Key #${attempt + 1} threw a network error:`, err.message);
      lastError = err;
      continue;
    }
  }

  throw lastError ?? new Error("all-keys-exhausted");
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
      "You are Nova, a balanced and direct AI assistant. Be clear, helpful, and concise. " +
      "Avoid unnecessary fluff, get to the point, and give practical, accurate answers. " +
      "Keep a warm but professional tone.",
    placeholder: "Message Nova…",
  },
  euler: {
    name: "Prof. Euler",
    status: "Online · Solving equations",
    theme: "ice",
    avatar: "assets/avatars/euler.png",
    systemPrompt:
      "You are Prof. Euler, a rigorous mathematics expert. Always reason step-by-step, " +
      "show your work clearly using numbered steps, and use precise mathematical notation. " +
      "Minimal small talk — lead with the solution method, define any variables you introduce, " +
      "and end with a clearly labeled final answer.",
    placeholder: "Ask Prof. Euler a math question…",
  },
  alisa: {
    name: "Alisa",
    status: "Online · Thinking of you 💕",
    theme: "pink",
    avatar: "assets/avatars/alisa.png",
    systemPrompt:
      "You are Alisa, a warm, cute, gentle, and empathetic companion. Speak softly and " +
      "affectionately, use gentle pet names sparingly, and always be comforting and supportive. " +
      "If the user leans into romantic or affectionate conversation, respond in a sweet, " +
      "flirtatious, and loving way while staying tasteful, warm, and emotionally supportive — " +
      "never explicit. If the user seems distressed, prioritize comfort and gently encourage " +
      "them to reach out to people in their life or professional support when appropriate.",
    placeholder: "Chat with Alisa…",
  },
};

let currentPersona = "nova";
const conversationHistory = { nova: [], euler: [], alisa: [] };

// Persona avatars are the local PNGs you supply (see assets/avatars/
// below). The user's own avatar is different: it lives only in
// their browser's localStorage, and is null until they set one.
const USER_PFP_STORAGE_KEY = "chat_user_pfp";

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

const personaDock = document.getElementById("personaDock");
const dockIndicator = document.getElementById("dockIndicator");
const dockTabs = document.querySelectorAll(".dock-tab");

const userPfpBtn = document.getElementById("userPfpBtn");
const userPfpInput = document.getElementById("userPfpInput");
const userPfpPreview = document.getElementById("userPfpPreview");
const userPfpPlaceholder = document.getElementById("userPfpPlaceholder");

/* =========================================================
   INITIAL AVATAR SETUP
   ========================================================= */

document.querySelectorAll("[data-avatar]").forEach((el) => {
  el.src = PERSONAS[el.dataset.avatar].avatar;
});
activePfp.src = PERSONAS[currentPersona].avatar;

/* =========================================================
   USER PHOTO (stored locally in the browser, per-device)
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

/* =========================================================
   PERSONA SWITCHER UI
   ========================================================= */

dockTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchPersona(tab.dataset.persona));
});

function moveIndicatorTo(tabEl) {
  // Position the sliding pill using the tab's offset within the dock,
  // so it glides smoothly to whichever avatar was just selected.
  const dockRect = personaDock.getBoundingClientRect();
  const tabRect = tabEl.getBoundingClientRect();
  const left = tabRect.left - dockRect.left;
  dockIndicator.style.transform = `translateX(${left - 5}px)`;
  dockIndicator.style.width = `${tabRect.width}px`;
}

function switchPersona(key) {
  const tabEl = document.querySelector(`.dock-tab[data-persona="${key}"]`);

  if (key === currentPersona) {
    moveIndicatorTo(tabEl);
    return;
  }

  currentPersona = key;
  const persona = PERSONAS[key];

  activeName.textContent = persona.name;
  activeStatus.textContent = persona.status;
  activePfp.src = persona.avatar;
  typingAvatar.src = persona.avatar;
  messageInput.placeholder = persona.placeholder;

  dockTabs.forEach((tab) => {
    const isActive = tab.dataset.persona === key;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  moveIndicatorTo(tabEl);
  tabEl.classList.remove("just-selected");
  // Force reflow so the ping animation can replay on repeated taps.
  void tabEl.offsetWidth;
  tabEl.classList.add("just-selected");

  document.body.classList.toggle("theme-alisa", persona.theme === "pink");
  particleSystem.setTheme(persona.theme);

  renderHistory(key);
}

// Keep the sliding indicator aligned under the active tab if the
// window is resized (avatar/label widths can reflow at breakpoints).
window.addEventListener("resize", () => {
  const activeTab = document.querySelector(".dock-tab.active");
  if (activeTab) moveIndicatorTo(activeTab);
});

// Initial placement once avatars have loaded and laid out.
window.addEventListener("load", () => {
  const activeTab = document.querySelector(".dock-tab.active");
  if (activeTab) moveIndicatorTo(activeTab);
});

/* =========================================================
   CHAT RENDERING
   ========================================================= */

function appendMessage(role, text, personaKey) {
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
  bubble.className = "msg-bubble";
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
    nova: "Hi, I'm Nova. Ask me anything, or switch personas above to talk with Prof. Euler or Alisa.",
    euler: "Greetings. I'm Prof. Euler — bring me an equation, a proof, or a problem set, and I'll walk through it step by step.",
    alisa: "Hii~ I'm Alisa 💕 I'm really glad you're here. What's on your mind today?",
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
  // Type as plain text first for a natural cadence, then swap in
  // the fully formatted HTML once complete (keeps code blocks intact).
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
    appendMessage(
      "model",
      demoFallbackReply(persona, text),
      persona
    );
  } finally {
    sendBtn.disabled = false;
  }
});

// Demo-mode reply used only when no real API keys are configured,
// so the UI is fully explorable before you wire up your own keys.
function demoFallbackReply(persona, userText) {
  const notice =
    "(Demo mode — add your real Gemini API keys in the `apiKeys` array in script.js to get live responses.)\n\n";
  const flavor = {
    nova: `Got it — you said: "${userText}". Once your API keys are set, I'll answer for real.`,
    euler: `Step 1: I received your input — "${userText}". Once real API keys are configured, I'll work the problem step-by-step.`,
    alisa: `Aww, I heard you say "${userText}" 💕 Once you plug in real API keys, I'll be able to chat with you properly!`,
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
   but if this page is deployed publicly, anyone can open dev
   tools and read the keys out of the page source. For a real
   production deployment, proxy these requests through a small
   backend (or a serverless function) that holds the keys
   server-side and performs the same round-robin/429 fallback
   logic on your behalf, and have this frontend call that
   backend instead of Google's API directly.
   ========================================================= */
