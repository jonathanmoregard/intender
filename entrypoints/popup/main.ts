import '@theme';
import browser from 'webextension-polyfill';
import {
  canParseIntention,
  makeRawIntention,
} from '../../components/intention';
import { storage } from '../../components/storage';

interface PopupElements {
  optionsCard: HTMLDivElement;
  quickAddOverlay: HTMLDivElement;
  quickAddBtn: HTMLButtonElement;
  settingsBtn: HTMLButtonElement;
  quickAddSave: HTMLButtonElement;
  urlInput: HTMLInputElement;
  phraseInput: HTMLTextAreaElement;
  statusMessage: HTMLDivElement;
  urlError: HTMLDivElement;
  successOverlay: HTMLDivElement;
}

class PopupController {
  private elements: PopupElements;
  private currentTab: browser.Tabs.Tab | null = null;

  constructor() {
    this.elements = {
      optionsCard: document.getElementById('options-card') as HTMLDivElement,
      quickAddOverlay: document.getElementById(
        'quick-add-overlay'
      ) as HTMLDivElement,
      quickAddBtn: document.getElementById(
        'quick-add-btn'
      ) as HTMLButtonElement,
      settingsBtn: document.getElementById('settings-btn') as HTMLButtonElement,
      quickAddSave: document.getElementById(
        'quick-add-save'
      ) as HTMLButtonElement,
      urlInput: document.getElementById('quick-add-url') as HTMLInputElement,
      phraseInput: document.getElementById(
        'quick-add-phrase'
      ) as HTMLTextAreaElement,
      statusMessage: document.getElementById('status') as HTMLDivElement,
      urlError: document.getElementById('url-error') as HTMLDivElement,
      successOverlay: document.getElementById(
        'success-overlay'
      ) as HTMLDivElement,
    };

    this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.loadCurrentTab();
      this.setupEventListeners();
      this.updateUI();

      // Check if direct to settings is enabled
      const data = await storage.get();
      if (data.directToSettings === true) {
        this.handleSettings();
        return;
      }

      await this.maybeRedirectToSettingsOnInvalidOrDuplicate();
    } catch (error) {
      console.error('Failed to initialise popup:', error);
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
    this.elements.urlInput.addEventListener('blur', () =>
      this.validateUrlField()
    );
    this.elements.urlInput.addEventListener('input', () =>
      this.clearUrlErrorOnTyping()
    );
    this.elements.quickAddSave.addEventListener('click', () =>
      this.handleSaveIntention()
    );
    this.elements.quickAddOverlay.addEventListener('click', event => {
      if (event.target === this.elements.quickAddOverlay) {
        this.closeQuickAdd();
      }
    });
    this.elements.phraseInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.handleSaveIntention();
      }
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.quickAddVisible()) {
        this.closeQuickAdd();
      }
    });
  }

  private updateUI(): void {
    if (!this.currentTab || !this.currentTab.url) {
      this.elements.quickAddBtn.disabled = true;
      this.elements.quickAddBtn.title = 'No active tab available';
      return;
    }

    this.elements.quickAddBtn.disabled = false;
    this.elements.quickAddBtn.title = `Add intention for ${this.getDisplayUrl()}`;
  }

  private getDisplayUrl(): string {
    if (!this.currentTab?.url) return 'current page';

    try {
      const url = new URL(this.currentTab.url);
      return url.hostname;
    } catch {
      return this.currentTab.url;
    }
  }

  private async handleQuickAdd(): Promise<void> {
    if (!this.currentTab?.url) {
      this.showStatus('No active tab available', 'error');
      return;
    }

    try {
      // Check if the current URL can be parsed
      const testIntention = makeRawIntention(this.currentTab.url, '');
      if (!canParseIntention(testIntention)) {
        this.showStatus('Cannot create intention for this URL', 'error');
        return;
      }

      const data = await storage.get();
      const existingIntentions = data.intentions || [];

      const existingIntention = existingIntentions.find(intention => {
        if (!intention.url) return false;
        return (
          this.normalizeUrl(intention.url) ===
          this.normalizeUrl(this.currentTab!.url!)
        );
      });

      if (existingIntention) {
        this.showStatus('Intention already exists for this site', 'error');
        return;
      }

      this.openQuickAdd();
    } catch (error) {
      console.error('Failed to check existing intentions:', error);
      this.showStatus('Could not prepare quick add', 'error');
    }
  }

  private async maybeRedirectToSettingsOnInvalidOrDuplicate(): Promise<void> {
    if (!this.currentTab?.url) return;
    try {
      const testIntention = makeRawIntention(this.currentTab.url, '');
      if (!canParseIntention(testIntention)) {
        this.handleSettings();
        return;
      }

      const data = await storage.get();
      const existingIntentions = data.intentions || [];
      const hasDuplicate = existingIntentions.some(intention => {
        if (!intention.url) return false;
        return (
          this.normalizeUrl(intention.url) ===
          this.normalizeUrl(this.currentTab!.url!)
        );
      });
      if (hasDuplicate) {
        this.handleSettings();
      }
    } catch (error) {
      // On any error, do not redirect; keep popup usable
      console.error('Validation failed during popup init:', error);
    }
  }

  private handleSettings(): void {
    browser.tabs.create({ url: browser.runtime.getURL('settings.html') });
    window.close();
  }

  private openQuickAdd(): void {
    if (!this.currentTab?.url) return;

    this.elements.urlInput.value = this.getDisplayUrl();
    this.elements.phraseInput.value = '';
    this.elements.urlInput.classList.remove('error');
    this.elements.urlError.classList.remove('show');

    this.elements.optionsCard.classList.add('hidden');
    this.elements.quickAddOverlay.classList.add('visible');
    setTimeout(() => {
      this.elements.phraseInput.focus();
      this.elements.phraseInput.select();
    }, 0);
  }

  private closeQuickAdd(): void {
    this.elements.quickAddOverlay.classList.remove('visible');
    this.elements.optionsCard.classList.remove('hidden');
    this.elements.urlInput.value = '';
    this.elements.phraseInput.value = '';
    this.elements.urlInput.classList.remove('error');
    this.elements.urlError.classList.remove('show');
  }

  private quickAddVisible(): boolean {
    return this.elements.quickAddOverlay.classList.contains('visible');
  }

  private async handleSaveIntention(): Promise<void> {
    const url = this.elements.urlInput.value.trim();
    const phrase = this.elements.phraseInput.value.trim();

    if (!url) {
      this.showStatus('Please enter a website', 'error');
      return;
    }

    if (!phrase) {
      this.showStatus('Please enter an intention', 'error');
      return;
    }

    // Ensure the edited URL is parseable before proceeding
    {
      const testIntention = makeRawIntention(url, '');
      if (!canParseIntention(testIntention)) {
        this.showStatus('Invalid URL', 'error');
        return;
      }
    }

    try {
      this.elements.quickAddSave.disabled = true;
      this.elements.quickAddSave.textContent = 'Adding...';

      const data = await storage.get();
      const existingIntentions = data.intentions || [];

      const existingIntention = existingIntentions.find(intention => {
        if (!intention.url) return false;
        return this.normalizeUrl(intention.url) === this.normalizeUrl(url);
      });

      if (existingIntention) {
        this.showStatus('Intention already exists for this site', 'error');
        return;
      }

      const newIntention = makeRawIntention(url, phrase);
      const updatedIntentions = [...existingIntentions, newIntention];

      await storage.set({ intentions: updatedIntentions });

      // Show success overlay
      this.elements.successOverlay.classList.add('visible');

      // Close the popup after a short delay
      setTimeout(() => {
        window.close();
      }, 500);
    } catch (error) {
      console.error('Failed to add intention:', error);
      this.showStatus('Failed to add intention', 'error');
    } finally {
      this.elements.quickAddSave.disabled = false;
      this.elements.quickAddSave.textContent = 'Add Intention';
    }
  }

  private showStatus(
    message: string,
    type: 'success' | 'error' | '' = ''
  ): void {
    if (!message) return;

    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message visible ${type}`;

    setTimeout(() => {
      this.elements.statusMessage.textContent = '';
      this.elements.statusMessage.className = 'status-message';
    }, 2500);
  }

  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      let normalized = urlObj.hostname.toLowerCase();
      if (normalized.startsWith('www.')) {
        normalized = normalized.substring(4);
      }
      return normalized;
    } catch {
      return url.toLowerCase();
    }
  }

  private validateUrlField(): void {
    const url = this.elements.urlInput.value.trim();
    if (!url) {
      this.elements.urlInput.classList.remove('error');
      this.elements.urlError.classList.remove('show');
      return;
    }
    const testIntention = makeRawIntention(url, '');
    if (!canParseIntention(testIntention)) {
      this.elements.urlInput.classList.add('error');
      this.elements.urlError.classList.add('show');
    } else {
      this.elements.urlInput.classList.remove('error');
      this.elements.urlError.classList.remove('show');
    }
  }

  private clearUrlErrorOnTyping(): void {
    if (this.elements.urlInput.classList.contains('error')) {
      this.elements.urlInput.classList.remove('error');
      this.elements.urlError.classList.remove('show');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PopupController());
} else {
  new PopupController();
}
