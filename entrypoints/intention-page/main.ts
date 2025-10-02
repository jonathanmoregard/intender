import '@theme';
import { fuzzyMatch, fuzzyPartialMatch } from '../../components/fuzzy-matching';
import { storage } from '../../components/storage';
import packageJson from '../../package.json';

// Particles animation setup
const canvas = document.getElementById('particles-canvas') as HTMLCanvasElement;

if (!canvas) {
  console.error('Canvas element not found');
}

const ctx = canvas.getContext('2d');

if (!ctx) {
  throw new Error('Could not get 2D context from canvas');
}

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

interface Particle {
  x: number;
  y: number;
  r: number;
  alpha: number;
  speedX: number;
  speedY: number;
  directionChangeTimer: number;
}

const PARTICLE_COUNT = 160;
const particles: Particle[] = [];

// Functions to generate consistent particle properties
const generateParticlePosition = () => ({
  x: Math.random() * canvas.width,
  y: (0.4 + Math.random() * 0.6) * canvas.height,
});

const generateParticleRadius = () => Math.random() * 1.8 + 1;

const generateParticleAlpha = () => Math.random() * 0.35 + 0.1; // Visible but ambient

const generateParticleSpeedX = () => (Math.random() - 0.5) * 0.15;

const generateParticleSpeedY = () => -0.05 - Math.random() * 0.05;

const generateDirectionChangeTimer = () => Math.random() * 200 + 100; // Random timer between 100-300 frames

for (let i = 0; i < PARTICLE_COUNT; i++) {
  const position = generateParticlePosition();

  particles.push({
    x: position.x,
    y: position.y,
    r: generateParticleRadius(),
    alpha: generateParticleAlpha(),
    speedX: generateParticleSpeedX(),
    speedY: generateParticleSpeedY(),
    directionChangeTimer: generateDirectionChangeTimer(),
  });
}

function draw() {
  ctx!.clearRect(0, 0, canvas.width, canvas.height);

  for (let p of particles) {
    // Draw golden and white particles
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, p.r, 0, 2 * Math.PI);

    // Alternate between golden and white
    if (p.x % 2 === 0) {
      ctx!.fillStyle = `rgba(254, 227, 164, ${p.alpha})`; // Golden
    } else {
      ctx!.fillStyle = `rgba(255, 255, 255, ${p.alpha})`; // White
    }
    ctx!.fill();

    // Update direction change timer
    p.directionChangeTimer--;

    // Occasionally change horizontal direction
    if (p.directionChangeTimer <= 0) {
      p.speedX = generateParticleSpeedX(); // New random horizontal speed
      p.directionChangeTimer = generateDirectionChangeTimer();
    }

    p.x += p.speedX;
    p.y += p.speedY;

    if (p.y < -10 || p.x < -10 || p.x > canvas.width + 10) {
      const position = generateParticlePosition();

      p.x = position.x;
      p.y = position.y;
      p.r = generateParticleRadius();
      p.alpha = generateParticleAlpha();
      p.speedX = generateParticleSpeedX();
      p.speedY = generateParticleSpeedY();
      p.directionChangeTimer = generateDirectionChangeTimer();
    }
  }

  requestAnimationFrame(draw);
}

draw();

// After first paint, upgrade background sources (MV3-safe; no inline script)
requestAnimationFrame(() => {
  document.documentElement.classList.add('bg-ready');
});

// Build footer (version + git hash with clipboard copy)
declare const __VERSION__: string | undefined;
declare const __GIT_HASH__: string | undefined;

const BUILD_VERSION: string = __VERSION__ ?? packageJson.version;
const BUILD_HASH: string = __GIT_HASH__ ?? 'dev';

requestAnimationFrame(() => {
  const el = document.getElementById('build-footer');
  if (el) {
    el.textContent = `v${BUILD_VERSION}`;
    el.setAttribute('title', BUILD_HASH);
    el.addEventListener('click', () => {
      navigator.clipboard.writeText(`${BUILD_VERSION} - ${BUILD_HASH}`);
    });
  }
});

const query = new URLSearchParams(window.location.search);
const target = query.get('target');
const intentionId = query.get('intentionScopeId');

const phraseDisplayEl = document.getElementById(
  'phrase-display'
) as HTMLElement;
const urlDisplayEl = document.getElementById('url-display') as HTMLElement;
const inputEl = document.getElementById('phrase') as HTMLTextAreaElement;
const buttonEl = document.getElementById('go') as HTMLButtonElement;
const helperTextEl = document.getElementById('helper-text') as HTMLElement;

let expectedPhrase = '';

// Display the target URL
if (urlDisplayEl && target) {
  try {
    const url = new URL(target);
    let hostname = url.hostname.replace(/^www\./, '');
    // Remove common suffixes
    hostname = hostname.replace(
      /\.(com|org|net|edu|gov|mil|co\.uk|co\.jp|de|fr|it|es|nl|be|se|no|dk|fi|pl|cz|hu|ro|bg|hr|sk|si|lt|lv|ee|lu|mt|cy|ie|pt|gr|at|ch|li)$/i,
      ''
    );
    urlDisplayEl.textContent = hostname;
  } catch {
    urlDisplayEl.textContent = target;
  }
}

storage
  .get()
  .then(
    ({ intentions, fuzzyMatching = true, canCopyIntentionText = false }) => {
      // Use intention ID for precise lookup
      const match = intentions.find(r => r.id === intentionId);
      if (match) {
        expectedPhrase = match.phrase;
        phraseDisplayEl.textContent = expectedPhrase;

        if (!canCopyIntentionText) {
          phraseDisplayEl.classList.add('no-copy');
          phraseDisplayEl.addEventListener('copy', e => e.preventDefault());
          phraseDisplayEl.addEventListener('contextmenu', e =>
            e.preventDefault()
          );
          phraseDisplayEl.addEventListener('selectstart', e =>
            e.preventDefault()
          );
        }

        // Unified fuzzy matching configuration
        const maxDistance = 2;

        // Function to check if input is an acceptable partial prompt
        const acceptablePartialPrompt = (input: string): boolean => {
          if (!fuzzyMatching) {
            return expectedPhrase.startsWith(input);
          } else {
            return fuzzyPartialMatch(input, expectedPhrase, maxDistance);
          }
        };

        // Function to check if input is an acceptable complete prompt
        const acceptableCompletePrompt = (input: string): boolean => {
          if (!fuzzyMatching) {
            return input === expectedPhrase;
          } else {
            return fuzzyMatch(input, expectedPhrase, maxDistance);
          }
        };

        // Set up input event listener for real-time validation
        inputEl.addEventListener('input', e => {
          // Prevent processing if this is from an Enter key press
          if (e instanceof InputEvent && e.inputType === 'insertLineBreak') {
            return;
          }

          const currentValue = inputEl.value;

          if (currentValue === '') {
            // Empty input - grey state
            phraseDisplayEl.className = 'phrase-display grey';
            inputEl.className = 'phrase-input grey';
            buttonEl.disabled = true;
            helperTextEl.classList.remove('visible');
          } else if (acceptablePartialPrompt(currentValue)) {
            // Partial match - green state (on the right track)
            phraseDisplayEl.className = 'phrase-display green';
            inputEl.className = 'phrase-input green';
            helperTextEl.classList.remove('visible');
            if (acceptableCompletePrompt(currentValue)) {
              buttonEl.disabled = false;
            } else {
              buttonEl.disabled = true;
            }
          } else {
            // Incorrect phrase - show red state immediately
            phraseDisplayEl.className = 'phrase-display red';
            inputEl.className = 'phrase-input red';
            buttonEl.disabled = true;
            helperTextEl.classList.add('visible');
          }
        });

        // Set up keydown event listener for Enter key
        inputEl.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault(); // Prevent newline from being added
            if (acceptableCompletePrompt(inputEl.value)) {
              const targetUrl = new URL(target!);
              targetUrl.searchParams.set('intention_completed_53c5890', 'true');
              window.location.href = targetUrl.toString();
            }
          }
        });

        // Set up button click handler
        buttonEl.onclick = () => {
          if (!buttonEl.disabled && acceptableCompletePrompt(inputEl.value)) {
            // Add click animation
            const container = document.querySelector(
              '.container'
            ) as HTMLElement;
            container.classList.add('clicking');

            // Navigate after animation
            setTimeout(() => {
              const targetUrl = new URL(target!);
              targetUrl.searchParams.set('intention_completed_53c5890', 'true');
              window.location.href = targetUrl.toString();
            }, 200);
          }
        };

        // Focus the input field
        inputEl.focus();
      } else {
        phraseDisplayEl.textContent = 'No phrase found for this URL';
        phraseDisplayEl.className = 'phrase-display red';
        inputEl.disabled = true;
        buttonEl.disabled = true;
      }
    }
  );
