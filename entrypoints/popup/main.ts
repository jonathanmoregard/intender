import browser from 'webextension-polyfill';
import { storage } from '../../components/storage';
import { makeRawIntention } from '../../components/intention';
import { generateUUID } from '../../components/uuid';

interface PopupElements {
  quickAddBtn: HTMLButtonElement;
  settingsBtn: HTMLButtonElement;
  status: HTMLDivElement;
}

class PopupController {
  private elements: PopupElements;
  private currentTab: browser.Tabs.Tab | null = null;

  constructor() {
    this.elements = {
      quickAddBtn: document.getElementById(
        'quick-add-btn'
      ) as HTMLButtonElement,
      settingsBtn: document.getElementById('settings-btn') as HTMLButtonElement,
      status: document.getElementById('status') as HTMLDivElement,
    };

    this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.loadCurrentTab();
      this.setupEventListeners();
      this.updateUI();
    } catch (error) {
      console.error('Failed to initialize popup:', error);
      this.showStatus('Failed to load popup', 'error');
    }
  }

  private async loadCurrentTab(): Promise<void> {
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      this.currentTab = tab;
    } catch (error) {
      console.error('Failed to get current tab:', error);
      this.currentTab = null;
    }
  }

  private setupEventListeners(): void {
    this.elements.quickAddBtn.addEventListener('click', () =>
      this.handleQuickAdd()
    );
    this.elements.settingsBtn.addEventListener('click', () =>
      this.handleSettings()
    );
  }

  private updateUI(): void {
    if (!this.currentTab || !this.currentTab.url) {
      this.elements.quickAddBtn.disabled = true;
      this.elements.quickAddBtn.title = 'No active tab available';
      return;
    }

    // Enable quick add if we have a valid tab
    this.elements.quickAddBtn.disabled = false;
    this.elements.quickAddBtn.title = `Quick add ${this.getDisplayUrl()}`;
  }

  private getDisplayUrl(): string {
    if (!this.currentTab?.url) return 'current page';

    try {
      const url = new URL(this.currentTab.url);
      return url.hostname;
    } catch {
      return 'current page';
    }
  }

  private async handleQuickAdd(): Promise<void> {
    if (!this.currentTab?.url) {
      this.showStatus('No active tab available', 'error');
      return;
    }

    try {
      this.elements.quickAddBtn.disabled = true;
      this.showStatus('Adding intention...', '');

      // Get current intentions
      const data = await storage.get();
      const existingIntentions = data.intentions || [];

      // Check if this URL already has an intention
      const existingIntention = existingIntentions.find(
        intention =>
          intention.url &&
          this.normalizeUrl(intention.url) ===
            this.normalizeUrl(this.currentTab!.url!)
      );

      if (existingIntention) {
        this.showStatus('Intention already exists for this site', 'error');
        this.elements.quickAddBtn.disabled = false;
        return;
      }

      // Create new intention
      const newIntention = makeRawIntention(this.currentTab.url, '');

      // Add to existing intentions
      const updatedIntentions = [...existingIntentions, newIntention];

      // Save to storage
      await storage.set({ intentions: updatedIntentions });

      this.showStatus('Intention added!', 'success');

      // Open settings after a brief delay to show success message
      setTimeout(() => {
        this.openSettings();
      }, 1000);
    } catch (error) {
      console.error('Failed to add intention:', error);
      this.showStatus('Failed to add intention', 'error');
    } finally {
      this.elements.quickAddBtn.disabled = false;
    }
  }

  private handleSettings(): void {
    this.openSettings();
  }

  private openSettings(): void {
    browser.tabs.create({
      url: browser.runtime.getURL('settings.html'),
    });
    window.close();
  }

  private showStatus(
    message: string,
    type: 'success' | 'error' | '' = ''
  ): void {
    this.elements.status.textContent = message;
    this.elements.status.className = `popup-status ${type}`;

    // Clear status after 3 seconds for success/error messages
    if (type) {
      setTimeout(() => {
        this.elements.status.textContent = '';
        this.elements.status.className = 'popup-status';
      }, 3000);
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Normalize by removing www, trailing slashes, and converting to lowercase
      let normalized = urlObj.hostname.toLowerCase();
      if (normalized.startsWith('www.')) {
        normalized = normalized.substring(4);
      }
      return normalized;
    } catch {
      return url.toLowerCase();
    }
  }
}

// Initialize popup when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PopupController());
} else {
  new PopupController();
}
