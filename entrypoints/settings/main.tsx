import '@theme';
import { debounce } from 'lodash-es';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  canParseIntention,
  emptyRawIntention,
  isEmpty,
  isPhraseEmpty,
  makeRawIntention,
  type RawIntention,
} from '../../components/intention';
import {
  storage,
  type BreathAnimationIntensity,
  type InactivityMode,
} from '../../components/storage';
import { minutesToMs, msToMinutes } from '../../components/time';
import { generateUUID } from '../../components/uuid';
import packageJson from '../../package.json';

type Tab = 'settings' | 'about';

// Build info fallbacks for environments where Vite define isn't injected
declare const __VERSION__: string | undefined;
declare const __GIT_HASH__: string | undefined;

const BUILD_VERSION: string = __VERSION__ ?? packageJson.version;
const BUILD_HASH: string = __GIT_HASH__ ?? 'dev';

const SettingsTab = memo(
  ({ setActiveTab }: { setActiveTab: (tab: Tab) => void }) => {
    const [intentions, setIntentions] = useState<RawIntention[]>([]);
    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      index: number | null;
    }>({
      show: false,
      index: null,
    });
    const [toast, setToast] = useState<{
      show: boolean;
      message: string;
      type: 'success' | 'error';
    }>({
      show: false,
      message: '',
      type: 'success',
    });
    const [showExamples, setShowExamples] = useState(false);
    const [showMoreOptions, setShowMoreOptions] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [fuzzyMatching, setFuzzyMatching] = useState(false);
    const [inactivityMode, setInactivityMode] = useState<InactivityMode>('off');
    const [inactivityTimeoutMinutes, setInactivityTimeoutMinutes] =
      useState(30);
    const [canCopyIntentionText, setCanCopyIntentionText] = useState(false);
    const [breathIntensity, setBreathIntensity] =
      useState<BreathAnimationIntensity>('minimal');

    const [blurredUrlIds, setBlurredUrlIds] = useState<Set<string>>(new Set());
    const [blurredPhraseIds, setBlurredPhraseIds] = useState<Set<string>>(
      new Set()
    );
    const [loadedIntentionIds, setLoadedIntentionIds] = useState<Set<string>>(
      new Set()
    );
    const [isShiftHeld, setIsShiftHeld] = useState(false);

    // ============================================================================
    // INTENTION CARD STATE MANAGEMENT
    // ============================================================================
    // Functions for managing the visual state of intention cards:
    // - Error highlighting (blurred inputs)
    // - Loaded state tracking (for initial vs new intentions)
    // - Focus/blur state management

    const markUrlBlurred = (id: string) => {
      setBlurredUrlIds(prev => new Set([...prev, id]));
    };

    const markUrlFocused = (id: string) => {
      setBlurredUrlIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    };

    const isUrlBlurred = (id: string) => {
      return blurredUrlIds.has(id);
    };

    const markPhraseBlurred = (id: string) => {
      setBlurredPhraseIds(prev => new Set([...prev, id]));
    };

    const markPhraseFocused = (id: string) => {
      setBlurredPhraseIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    };

    const isPhraseBlurred = (id: string) => {
      return blurredPhraseIds.has(id);
    };

    const isLoaded = (id: string) => {
      return loadedIntentionIds.has(id);
    };

    const updateLoadedIntentionIds = (
      ids: Set<string> | ((prev: Set<string>) => Set<string>)
    ) => {
      if (typeof ids === 'function') {
        setLoadedIntentionIds(ids);
      } else {
        setLoadedIntentionIds(ids);
      }
    };

    // ============================================================================
    // END INTENTION CARD STATE MANAGEMENT
    // ============================================================================

    const urlInputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const moreOptionsRef = useRef<HTMLDivElement>(null);

    const isIntentionEmpty = useCallback((intention: RawIntention) => {
      return isEmpty(intention);
    }, []);

    const focusNewIntentionUrl = useCallback((intentionIndex: number) => {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        urlInputRefs.current[intentionIndex]?.focus();
      }, 50);
    }, []);

    const saveIntentions = useCallback(
      async (intentionsToSave: RawIntention[]) => {
        await storage.set({ intentions: intentionsToSave });
      },
      []
    );

    const saveFuzzyMatching = useCallback(async (enabled: boolean) => {
      await storage.set({ fuzzyMatching: enabled });
    }, []);

    const saveInactivityMode = useCallback(async (mode: InactivityMode) => {
      await storage.set({ inactivityMode: mode });
    }, []);

    const saveInactivityTimeout = useCallback(
      async (timeoutMinutes: number) => {
        await storage.set({ inactivityTimeoutMs: minutesToMs(timeoutMinutes) });
      },
      []
    );

    const saveBreathAnimationIntensity = useCallback(
      async (intensity: BreathAnimationIntensity) => {
        await storage.set({ breathAnimationIntensity: intensity });
      },
      []
    );

    const saveAdvancedSettingsState = useCallback(async (expanded: boolean) => {
      await storage.set({ showAdvancedSettings: expanded });
    }, []);

    const saveCanCopyIntentionText = useCallback(async (enabled: boolean) => {
      await storage.set({ canCopyIntentionText: enabled });
    }, []);

    // Debounced save function
    const debouncedSave = useCallback(
      debounce(async (intentionsToSave: RawIntention[]) => {
        try {
          await saveIntentions(intentionsToSave);
        } catch (error) {
          console.error('Failed to auto-save intentions:', error);
          // Don't show toast for auto-save failures, only log them
        }
      }, 1000),
      [isIntentionEmpty]
    );

    useEffect(() => {
      storage.get().then(async data => {
        const initialIntentions =
          data.intentions.length > 0 ? data.intentions : [emptyRawIntention()];
        setIntentions(initialIntentions);
        setFuzzyMatching(data.fuzzyMatching ?? true);
        setInactivityMode(data.inactivityMode ?? 'off');
        setInactivityTimeoutMinutes(
          data.inactivityTimeoutMs
            ? msToMinutes(data.inactivityTimeoutMs as any)
            : 30
        );
        setShowAdvancedSettings(data.showAdvancedSettings ?? false);
        setCanCopyIntentionText(data.canCopyIntentionText ?? false);
        setBreathIntensity(
          (data.breathAnimationIntensity as BreathAnimationIntensity) ??
            'minimal'
        );

        // E2E testing hook: allow overriding inactivity timeout via query param
        try {
          const url = new URL(window.location.href);
          const override = url.searchParams.get('e2eInactivityTimeoutMs');
          if (override) {
            const parsed = Number(override);
            if (Number.isFinite(parsed) && parsed > 0) {
              await storage.set({ inactivityTimeoutMs: parsed as any });
              setInactivityTimeoutMinutes(msToMinutes(parsed));
            }
          }
        } catch {}

        // Track which intentions were loaded from storage (not newly created)
        const loadedIds = new Set<string>();
        initialIntentions.forEach(intention => {
          if (!isEmpty(intention)) {
            loadedIds.add(intention.id);
          }
        });
        updateLoadedIntentionIds(loadedIds);

        // Check if we should show examples based on initial load
        const nonEmptyIntentions = initialIntentions.filter(
          intention => !isEmpty(intention)
        );
        setShowExamples(nonEmptyIntentions.length < 2);

        // Auto-focus first empty unparseable intention URL
        const firstEmptyIndex = initialIntentions.findIndex(
          (intention: RawIntention) => {
            return isEmpty(intention);
          }
        );
        if (firstEmptyIndex !== -1) {
          setTimeout(() => {
            urlInputRefs.current[firstEmptyIndex]?.focus();
          }, 100);
        }
      });
    }, []);

    // Debounced auto-save whenever intentions change (except during initial load)
    useEffect(() => {
      // Don't save during initial load (when intentions are empty and we're about to load from storage)
      if (intentions.length > 0) {
        debouncedSave(intentions);
      }
    }, [intentions, debouncedSave]);

    // Track shift key state
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Shift') {
          setIsShiftHeld(true);
        }
      };

      const handleKeyUp = (event: KeyboardEvent) => {
        if (event.key === 'Shift') {
          setIsShiftHeld(false);
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keyup', handleKeyUp);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keyup', handleKeyUp);
      };
    }, []);

    // Close more options dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          moreOptionsRef.current &&
          !moreOptionsRef.current.contains(event.target as Node)
        ) {
          setShowMoreOptions(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, []);

    const update = async () => {
      await saveIntentions(intentions);

      // Show success toast only when manually saving
      const cleanIntentions = intentions.filter(
        intention => !isEmpty(intention)
      );
      setToast({
        show: true,
        message: `Successfully saved ${cleanIntentions.length} intention(s)`,
        type: 'success',
      });
      setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);

      // Ensure we always have at least one intention (empty if needed)
      setIntentions(
        cleanIntentions.length > 0 ? cleanIntentions : [emptyRawIntention()]
      );
    };

    const addIntention = () => {
      setIntentions(prev => {
        const newIntentions = [...prev, emptyRawIntention()];
        // Focus the new intention's URL input
        focusNewIntentionUrl(newIntentions.length - 1);
        return newIntentions;
      });
      // Newly created intentions are not marked as loaded
    };

    const addExampleIntention = (example: { url: string; phrase: string }) => {
      setIntentions(prev => {
        const newIntention = makeRawIntention(example.url, example.phrase);
        const newIntentions = [newIntention, ...prev];

        // Mark the newly added example as solidified
        updateLoadedIntentionIds(prev => new Set([...prev, newIntention.id]));

        return newIntentions;
      });
    };

    const remove = (index: number, skipConfirmation: boolean) => {
      const intention = intentions[index];
      const hasContent = !isEmpty(intention);

      // Skip confirmation if shift is held or explicitly requested
      if (hasContent && !skipConfirmation) {
        setDeleteConfirm({ show: true, index });
        return;
      }

      // Delete immediately
      performDelete(index);
    };

    const performDelete = (index: number) => {
      const newIntentions = intentions.filter((_, i) => i !== index);
      // Ensure we always have at least one intention (empty if needed)
      const finalIntentions =
        newIntentions.length > 0 ? newIntentions : [emptyRawIntention()];
      setIntentions(finalIntentions);

      // Update loaded IDs after deletion - remove the deleted intention's ID
      const deletedIntention = intentions[index];
      if (deletedIntention) {
        updateLoadedIntentionIds(prev => {
          const newLoadedIds = new Set(prev);
          newLoadedIds.delete(deletedIntention.id);
          return newLoadedIds;
        });
      }
    };

    const confirmDelete = () => {
      if (deleteConfirm.index !== null) {
        performDelete(deleteConfirm.index);
      }
      setDeleteConfirm({ show: false, index: null });
    };

    const cancelDelete = () => {
      setDeleteConfirm({ show: false, index: null });
    };

    const handlePhraseBlur = (intentionIndex: number) => {
      // Remove auto-adding on blur since we handle it in keydown
      // This was causing conflicts with tab navigation
    };

    const handlePhraseKeyDown = (
      e: React.KeyboardEvent,
      intentionIndex: number
    ) => {
      // Only add new intention on unmodified Tab key (not shift+tab)
      if (
        e.key === 'Tab' &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        const intention = intentions[intentionIndex];
        const isLastIntention = intentionIndex === intentions.length - 1;

        if (isLastIntention) {
          e.preventDefault();
          setIntentions(prev => {
            const newIntentions = [...prev, emptyRawIntention()];
            // Focus the new intention's URL input
            focusNewIntentionUrl(newIntentions.length - 1);
            return newIntentions;
          });
        }
      }
    };

    const exampleIntentions = [
      {
        url: 'reddit.com',
        phrase: 'I want to access something specific',
      },
      {
        url: 'facebook.com',
        phrase: 'I want to use events/chat, and have set a 5 minute timer',
      },
      {
        url: 'gmail.com',
        phrase: 'I am not checking my email out of habit/boredom',
      },
    ];

    // Filter out examples that match existing intentions
    const filteredExampleIntentions = exampleIntentions.filter(example => {
      return !intentions.some(
        intention => !isEmpty(intention) && intention.url === example.url
      );
    });

    const exportSettings = async () => {
      try {
        // Get all current settings
        const allSettings = await storage.get();
        const nonemptyIntentions = intentions.filter(
          intention => !isEmpty(intention)
        );

        const exportData = {
          ...allSettings,
          version: BUILD_VERSION,
          intentions: nonemptyIntentions,
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'intender-settings.json';
        link.click();
        URL.revokeObjectURL(url);

        setToast({
          show: true,
          message: `Settings Exported`,
          type: 'success',
        });
        setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
      } catch (error) {
        console.error('Export failed:', error);
        setToast({
          show: true,
          message: 'Failed to export settings',
          type: 'error',
        });
        setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
      }
    };

    const importSettings = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async e => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        try {
          const text = await file.text();
          const importedData = JSON.parse(text);

          // Handle both old format (just intentions array) and new format (full settings object)
          if (Array.isArray(importedData)) {
            // Old format: just intentions array
            const processedIntentions = importedData.map(intention => ({
              ...intention,
              id: generateUUID(),
            }));

            setIntentions(processedIntentions);
            await storage.set({ intentions: processedIntentions });

            // Mark all imported intentions as loaded
            const importedIds = new Set(
              processedIntentions.map(intention => intention.id as string)
            );
            updateLoadedIntentionIds(importedIds);

            setToast({
              show: true,
              message: `Settings Imported`,
              type: 'success',
            });
            setTimeout(
              () => setToast(prev => ({ ...prev, show: false })),
              3000
            );
          } else {
            // New format: full settings object - load all settings except version
            const {
              version,
              intentions: importedIntentions,
              ...otherSettings
            } = importedData;

            // Process intentions with new IDs
            const processedIntentions = (importedIntentions || []).map(
              (intention: any) => ({
                ...intention,
                id: generateUUID(),
              })
            ) as RawIntention[];

            // Load all settings (excluding version)
            const settingsToApply = {
              ...otherSettings,
              intentions: processedIntentions,
            };

            setIntentions(processedIntentions);
            await storage.set(settingsToApply);

            // Update UI state for all settings
            if (settingsToApply.fuzzyMatching !== undefined) {
              setFuzzyMatching(settingsToApply.fuzzyMatching);
            }
            if (settingsToApply.inactivityMode !== undefined) {
              setInactivityMode(settingsToApply.inactivityMode);
            }
            if (settingsToApply.inactivityTimeoutMs !== undefined) {
              setInactivityTimeoutMinutes(
                msToMinutes(settingsToApply.inactivityTimeoutMs)
              );
            }
            if (settingsToApply.showAdvancedSettings !== undefined) {
              setShowAdvancedSettings(settingsToApply.showAdvancedSettings);
            }
            if (settingsToApply.canCopyIntentionText !== undefined) {
              setCanCopyIntentionText(settingsToApply.canCopyIntentionText);
            }

            // Mark all imported intentions as loaded
            const importedIds = new Set(
              processedIntentions.map(intention => intention.id as string)
            );
            updateLoadedIntentionIds(importedIds);

            setToast({
              show: true,
              message: `Settings Imported`,
              type: 'success',
            });
            setTimeout(
              () => setToast(prev => ({ ...prev, show: false })),
              3000
            );
          }
        } catch (error) {
          console.error('Import failed:', error);
          setToast({
            show: true,
            message:
              "Ooops! Couldn't understand the file you picked for import. Are you sure it's the right one?",
            type: 'error',
          });
          setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
        }
      };
      input.click();
    };

    const intensityOptions: BreathAnimationIntensity[] = [
      'off',
      'minimal',
      'medium',
      'heavy',
    ];

    const intensityIndex = Math.max(
      0,
      intensityOptions.indexOf(breathIntensity)
    );

    const [sliderValue, setSliderValue] = useState<number>(intensityIndex);
    const sliderContainerRef = useRef<HTMLDivElement | null>(null);
    const pointerDownRef = useRef<boolean>(false);
    const dragVisualActiveRef = useRef<boolean>(true);
    const lastDistanceRef = useRef<number>(0);
    const prevValueRef = useRef<number>(sliderValue);

    useEffect(() => {
      setSliderValue(intensityIndex);
      // update CSS var for fake thumb
      const pct = (intensityIndex / (intensityOptions.length - 1)) * 100;
      if (sliderContainerRef.current) {
        sliderContainerRef.current.style.setProperty(
          '--slider-position',
          `${pct}%`
        );
      }
    }, [intensityIndex, intensityOptions.length]);

    return (
      <div className='settings-tab'>
        {/* 1. Intentions */}
        <h2>Your intentions</h2>
        <p className='description'>
          Choose the sites and write a short intention. When you visit them,
          you’ll pause for a moment to re‑enter your intention.
        </p>

        <div className='intentions-list'>
          {intentions.map((intention, i) => (
            <div key={intention.id || `new-${i}`} className='intention-item'>
              <div className='intention-inputs'>
                <div className='url-section'>
                  <div className='input-group'>
                    <input
                      ref={el => {
                        urlInputRefs.current[i] = el;
                      }}
                      type='text'
                      className={`url-input ${
                        (isUrlBlurred(intention.id) ||
                          isLoaded(intention.id)) &&
                        !isEmpty(intention) &&
                        !canParseIntention(intention)
                          ? 'error'
                          : ''
                      } ${
                        (isUrlBlurred(intention.id) ||
                          isLoaded(intention.id)) &&
                        canParseIntention(intention)
                          ? 'parseable'
                          : ''
                      }`}
                      value={intention.url}
                      onChange={e => {
                        const newIntentions = [...intentions];
                        newIntentions[i] = {
                          ...newIntentions[i],
                          url: e.target.value,
                        };
                        setIntentions(newIntentions);
                      }}
                      onFocus={() => markUrlFocused(intention.id)}
                      onBlur={() => markUrlBlurred(intention.id)}
                      placeholder='Website (e.g., example.com)'
                    />
                    <label className='input-label'>Website</label>
                    {(isUrlBlurred(intention.id) || isLoaded(intention.id)) &&
                      canParseIntention(intention) && (
                        <span className='valid-checkmark'>✓</span>
                      )}
                  </div>

                  {(isUrlBlurred(intention.id) || isLoaded(intention.id)) &&
                    !isEmpty(intention) &&
                    !canParseIntention(intention) && (
                      <div className='error-text show'>
                        Enter a website like example.com
                      </div>
                    )}
                </div>

                <div className='input-group'>
                  <textarea
                    className={`phrase-input ${
                      isPhraseBlurred(intention.id) &&
                      !isEmpty(intention) &&
                      canParseIntention(intention) &&
                      isPhraseEmpty(intention.phrase)
                        ? 'error'
                        : ''
                    }`}
                    value={intention.phrase}
                    onChange={e => {
                      const newIntentions = [...intentions];
                      newIntentions[i] = {
                        ...newIntentions[i],
                        phrase: e.target.value,
                      };
                      setIntentions(newIntentions);
                    }}
                    onFocus={() => markPhraseFocused(intention.id)}
                    onBlur={() => {
                      markPhraseBlurred(intention.id);
                      handlePhraseBlur(i);
                    }}
                    onKeyDown={e => handlePhraseKeyDown(e, i)}
                    placeholder='Write your intention'
                    maxLength={150}
                    rows={2}
                  />
                  <label className='input-label'>Intention</label>
                  {isPhraseBlurred(intention.id) &&
                    !isEmpty(intention) &&
                    canParseIntention(intention) &&
                    isPhraseEmpty(intention.phrase) && (
                      <div className='error-text show'>
                        Please write your intention
                      </div>
                    )}
                </div>
              </div>

              <div className='remove-btn-wrapper'>
                <button
                  className={`remove-btn ${isShiftHeld ? 'shift-held' : ''} ${
                    intentions.length === 1 && isEmpty(intention)
                      ? 'disabled'
                      : ''
                  }`}
                  onClick={() => remove(i, isShiftHeld)}
                  title={
                    intentions.length === 1 && isEmpty(intention)
                      ? 'Cannot delete the last intention'
                      : isShiftHeld
                        ? 'Remove intention (no confirmation)'
                        : 'Remove intention (hold Shift to skip confirmation)'
                  }
                  tabIndex={-1}
                  disabled={intentions.length === 1 && isEmpty(intention)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 1b. Buttons */}
        <div className='actions'>
          <button
            className='add-btn'
            onClick={addIntention}
            title='Add another intention'
          >
            Add Intention
          </button>
          <button className='save-btn' onClick={update}>
            Save Changes
          </button>
          <div className='more-options' ref={moreOptionsRef}>
            <button
              className='more-options-btn'
              data-testid='more-options-btn'
              onClick={() => setShowMoreOptions(!showMoreOptions)}
              title='More options'
            >
              ⋯
            </button>
            <div
              className={`more-options-dropdown ${
                showMoreOptions ? 'show' : ''
              }`}
              data-testid='more-options-dropdown'
            >
              <button
                className='dropdown-item'
                data-testid='export-settings-btn'
                onClick={exportSettings}
              >
                Export Settings
              </button>
              <button
                className='dropdown-item'
                data-testid='import-settings-btn'
                onClick={importSettings}
              >
                Import Settings
              </button>
            </div>
          </div>
        </div>

        {/* 2. Example Intentions */}
        {showExamples && filteredExampleIntentions.length > 0 && (
          <div className='examples-section'>
            <h3>Examples to try</h3>
            <p className='examples-description'>
              Quick add these to get started:
            </p>
            <div className='examples-list'>
              {filteredExampleIntentions.map((example, i) => (
                <div key={`example-${i}`} className='example-item'>
                  <div className='example-content'>
                    <div className='example-url'>{example.url}</div>
                    <div className='example-phrase'>{example.phrase}</div>
                  </div>
                  <button
                    className='quick-add-btn'
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => addExampleIntention(example)}
                    title={`Add ${example.url} intention`}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Advanced Settings */}
        <div className='advanced-settings'>
          <div
            className={`advanced-settings-header ${showAdvancedSettings ? 'expanded' : ''}`}
            data-testid='advanced-settings-toggle'
            onClick={() => {
              const newState = !showAdvancedSettings;
              setShowAdvancedSettings(newState);
              saveAdvancedSettingsState(newState);
              if (!showAdvancedSettings) {
                // Scroll to the advanced settings when opening
                setTimeout(() => {
                  document.querySelector('.advanced-settings')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                }, 100);
              }
            }}
          >
            <span
              className={`toggle-icon ${showAdvancedSettings ? 'expanded' : ''}`}
            >
              ▼
            </span>
            <h3>Advanced settings</h3>
          </div>

          <div
            className={`advanced-settings-content ${showAdvancedSettings ? 'expanded' : ''}`}
          >
            <div className='setting-group'>
              <div className='setting-item'>
                <div className='setting-header'>
                  <span className='setting-text'>
                    Intention on inactive tabs?
                  </span>
                  <div
                    className='setting-help'
                    aria-label='If you return to a tab after a having been away for some time, do you want to se an intention page?'
                    data-tooltip='If you return to a tab after a having been away for some time, do you want to se an intention page?'
                  >
                    ?
                  </div>
                </div>
                <div className='radio-group-horizontal'>
                  <label className='radio-option'>
                    <input
                      data-testid='inactivity-mode-all'
                      type='radio'
                      name='inactivityMode'
                      value='all'
                      checked={inactivityMode === 'all'}
                      onChange={e => {
                        const mode = e.target.value as InactivityMode;
                        setInactivityMode(mode);
                        saveInactivityMode(mode);
                      }}
                    />
                    <span className='radio-label'>All Inactive Tabs</span>
                  </label>
                  <label className='radio-option'>
                    <input
                      data-testid='inactivity-mode-all-except-audio'
                      type='radio'
                      name='inactivityMode'
                      value='all-except-audio'
                      checked={inactivityMode === 'all-except-audio'}
                      onChange={e => {
                        const mode = e.target.value as InactivityMode;
                        setInactivityMode(mode);
                        saveInactivityMode(mode);
                      }}
                    />
                    <span className='radio-label'>
                      Silent Inactive Tabs
                      <div
                        className='setting-help'
                        aria-label='Good if you play music in background tabs. With this setting, tabs playing music never count as inactive: only silent tabs get intention pages on inactivity.'
                        data-tooltip='Good if you play music in background tabs. With this setting, tabs playing music never count as inactive: only silent tabs get intention pages on inactivity.'
                      >
                        ?
                      </div>
                    </span>
                  </label>
                  <label className='radio-option'>
                    <input
                      data-testid='inactivity-mode-off'
                      type='radio'
                      name='inactivityMode'
                      value='off'
                      checked={inactivityMode === 'off'}
                      onChange={e => {
                        const mode = e.target.value as InactivityMode;
                        setInactivityMode(mode);
                        saveInactivityMode(mode);
                      }}
                    />
                    <span className='radio-label'>Never</span>
                  </label>
                </div>

                <div
                  className={`timeout-setting ${inactivityMode === 'off' ? 'disabled' : ''}`}
                >
                  <input
                    data-testid='inactivity-timeout-minutes'
                    type='number'
                    min='1'
                    max='480'
                    value={inactivityTimeoutMinutes}
                    onChange={e => {
                      const timeout = parseInt(e.target.value) || 30;
                      setInactivityTimeoutMinutes(timeout);
                      saveInactivityTimeout(timeout);
                    }}
                    className='timeout-input'
                    disabled={inactivityMode === 'off'}
                  />
                  <div className='timeout-label-group'>
                    <span className='setting-text'>
                      Inactive time before intention check?
                    </span>
                    <span className='timeout-unit'>(minutes)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Move typos card below inactivity */}
            <div className='setting-group'>
              <label className='setting-label clickable-setting-item'>
                <input
                  type='checkbox'
                  checked={fuzzyMatching}
                  onChange={e => {
                    const enabled = e.target.checked;
                    setFuzzyMatching(enabled);
                    saveFuzzyMatching(enabled);
                  }}
                />
                <span className='setting-text'>
                  Allow small typos when typing your intention
                </span>
              </label>
            </div>

            <div className='setting-group'>
              <label className='setting-label clickable-setting-item'>
                <input
                  type='checkbox'
                  checked={canCopyIntentionText}
                  onChange={e => {
                    const enabled = e.target.checked;
                    setCanCopyIntentionText(enabled);
                    saveCanCopyIntentionText(enabled);
                  }}
                />
                <span className='setting-text'>Can copy intention text</span>
              </label>
            </div>

            {/* Breath Intensity Slider - moved to bottom */}
            <div className='setting-group'>
              <div className='setting-item'>
                <div className='setting-header'>
                  <span className='setting-text'>
                    Breath animation intensity
                  </span>
                  <div
                    className='setting-help'
                    aria-label='The box on the intention page grows and shrinks in a breathing pattern, this slider controls how big the breath movements are.'
                    data-tooltip='The box on the intention page grows and shrinks in a breathing pattern, this slider controls how big the breath movements are.'
                  >
                    ?
                  </div>
                </div>
                <div
                  className='slider-container'
                  ref={el => {
                    sliderContainerRef.current = el;
                  }}
                  role='group'
                  aria-label='Breath animation intensity'
                >
                  <input
                    type='range'
                    min='0'
                    max='3'
                    step='1'
                    value={sliderValue}
                    onMouseDown={e => {
                      pointerDownRef.current = true;
                      dragVisualActiveRef.current = true;
                      prevValueRef.current = sliderValue;
                      const scaleEl = sliderContainerRef.current?.querySelector(
                        '.slider-scale'
                      ) as HTMLDivElement | null;
                      const rect = scaleEl?.getBoundingClientRect();
                      if (rect) {
                        const thumbPct =
                          sliderValue / (intensityOptions.length - 1);
                        const thumbX = rect.left + rect.width * thumbPct;
                        lastDistanceRef.current = Math.abs(e.clientX - thumbX);
                      } else {
                        lastDistanceRef.current = 0;
                      }
                      sliderContainerRef.current?.classList.add('dragged');
                    }}
                    onMouseMove={e => {
                      if (
                        !pointerDownRef.current ||
                        !sliderContainerRef.current
                      )
                        return;
                      const scaleEl = sliderContainerRef.current.querySelector(
                        '.slider-scale'
                      ) as HTMLDivElement | null;
                      const rect = scaleEl?.getBoundingClientRect();
                      if (!rect) return;
                      const thumbPct =
                        sliderValue / (intensityOptions.length - 1);
                      const thumbX = rect.left + rect.width * thumbPct;
                      const distPx = e.clientX - thumbX;
                      const absDist = Math.abs(distPx);
                      // On snap (value changed), pause visual drag and record new baseline distance
                      if (sliderValue !== prevValueRef.current) {
                        dragVisualActiveRef.current = false;
                        sliderContainerRef.current.classList.remove('dragged');
                        sliderContainerRef.current.style.removeProperty(
                          '--drag-offset-px'
                        );
                        lastDistanceRef.current = absDist;
                        prevValueRef.current = sliderValue;
                        return;
                      }
                      if (!dragVisualActiveRef.current) {
                        if (absDist > lastDistanceRef.current) {
                          dragVisualActiveRef.current = true;
                          sliderContainerRef.current.classList.add('dragged');
                        } else {
                          lastDistanceRef.current = absDist;
                          return;
                        }
                      }
                      if (!dragVisualActiveRef.current) {
                        if (absDist > lastDistanceRef.current) {
                          dragVisualActiveRef.current = true;
                          sliderContainerRef.current.classList.add('dragged');
                        } else {
                          lastDistanceRef.current = absDist;
                          return;
                        }
                      }
                      // Non-linear stretchy mapping: fast initially, then ease out
                      // offset = sign(dist) * max * (1 - exp(-|dist| / scale))
                      const max = 10; // px cap
                      const scale = 40; // larger -> slower growth
                      const easedMagnitude =
                        max * (1 - Math.exp(-Math.abs(distPx) / scale));
                      const clamped =
                        (distPx >= 0 ? 1 : -1) * Math.min(max, easedMagnitude);
                      sliderContainerRef.current.style.setProperty(
                        '--drag-offset-px',
                        `${clamped}px`
                      );
                    }}
                    onMouseUp={() => {
                      pointerDownRef.current = false;
                      dragVisualActiveRef.current = false;
                      if (sliderContainerRef.current) {
                        sliderContainerRef.current.classList.remove('dragged');
                        sliderContainerRef.current.style.removeProperty(
                          '--drag-offset-px'
                        );
                      }
                    }}
                    onMouseLeave={() => {
                      pointerDownRef.current = false;
                      dragVisualActiveRef.current = false;
                      if (sliderContainerRef.current) {
                        sliderContainerRef.current.classList.remove('dragged');
                        sliderContainerRef.current.style.removeProperty(
                          '--drag-offset-px'
                        );
                      }
                    }}
                    onChange={e => {
                      const index = Number(e.target.value);
                      setSliderValue(index);
                      const next = intensityOptions[index] ?? 'minimal';
                      setBreathIntensity(next);
                      saveBreathAnimationIntensity(next);
                    }}
                    className='slider-input'
                    aria-valuemin={0}
                    aria-valuemax={3}
                    aria-valuenow={sliderValue}
                    aria-valuetext={breathIntensity}
                  />
                  <div
                    className='slider-scale'
                    aria-hidden='true'
                    onClick={e => {
                      const rect = (
                        e.currentTarget as HTMLDivElement
                      ).getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const fraction = Math.max(0, Math.min(1, x / rect.width));
                      const idx = Math.round(
                        fraction * (intensityOptions.length - 1)
                      );
                      setSliderValue(idx);
                      const next = intensityOptions[idx] ?? 'minimal';
                      setBreathIntensity(next);
                      saveBreathAnimationIntensity(next);
                    }}
                  >
                    <span
                      className='tick'
                      data-label='Off'
                      role='button'
                      tabIndex={0}
                      onClick={() => setSliderValue(0)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ')
                          setSliderValue(0);
                      }}
                    ></span>
                    <span
                      className='tick'
                      data-label='Minimal'
                      role='button'
                      tabIndex={0}
                      onClick={() => setSliderValue(1)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ')
                          setSliderValue(1);
                      }}
                    ></span>
                    <span
                      className='tick'
                      data-label='Medium'
                      role='button'
                      tabIndex={0}
                      onClick={() => setSliderValue(2)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ')
                          setSliderValue(2);
                      }}
                    ></span>
                    <span
                      className='tick'
                      data-label='Heavy'
                      role='button'
                      tabIndex={0}
                      onClick={() => setSliderValue(3)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ')
                          setSliderValue(3);
                      }}
                    ></span>
                    <span className='fake-thumb'></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        {deleteConfirm.show && (
          <div className='confirmation-overlay' onClick={cancelDelete}>
            <div
              className='confirmation-dialog'
              onClick={e => e.stopPropagation()}
            >
              <h3>Delete Intention</h3>
              <p>
                Are you sure you want to delete this intention? This action
                cannot be undone.
              </p>
              <div className='confirmation-actions'>
                <button className='cancel-btn' onClick={cancelDelete}>
                  Cancel
                </button>
                <button className='confirm-btn' onClick={confirmDelete}>
                  Delete
                </button>
              </div>
              <p className='hint'>
                💡 Tip: Hold Shift and click delete to skip this dialog.
              </p>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {toast.show && (
          <div
            className={`toast ${toast.type}`}
            style={{
              position: 'fixed',
              top: '20px',
              right: '20px',
              padding: '12px 20px',
              borderRadius: '6px',
              color: 'white',
              fontSize: '14px',
              fontWeight: '500',
              zIndex: 2000,
              backgroundColor:
                toast.type === 'success' ? 'var(--success)' : 'var(--error)',
              boxShadow: '0 4px 12px rgba(var(--shadow-weak-rgb), 0.15)',
              animation: 'slideIn 0.3s ease-out',
            }}
          >
            {toast.message}
          </div>
        )}
      </div>
    );
  }
);

const AboutTab = memo(() => {
  return (
    <div className='about-tab'>
      <h2>About Intender</h2>
      <div className='about-content'>
        <p>
          Intender is a browser extension that helps you pause and reflect
          before visiting certain websites. It gives you an opportunity to
          reflect and write down an intention before you enter the page.
        </p>

        <h3>How it works</h3>
        <ol>
          <li>Configure websites and phrases in the Settings tab</li>
          <li>
            When you visit a configured website, Intender shows a pause page
          </li>
          <li>Type your intention phrase to continue to the website</li>
          <li>This creates a moment of intentionality before browsing</li>
        </ol>

        <h3>Features</h3>
        <ul>
          <li>Custom phrases for different websites</li>
          <li>Beautiful, mindful pause page design</li>
          <li>Real-time phrase validation</li>
          <li>Simple, distraction-free interface</li>
        </ul>

        <div className='version-info'>
          <p>
            <strong>Version:</strong> {packageJson.version}
          </p>
          <p>
            <strong>Made with:</strong> React, TypeScript, WXT
          </p>
        </div>
      </div>
    </div>
  );
});

const Sidebar = memo(
  ({
    activeTab,
    setActiveTab,
    onTabChange,
  }: {
    activeTab: Tab;
    setActiveTab: (tab: Tab) => void;
    onTabChange: (newTab: Tab, setActiveTab: (tab: Tab) => void) => void;
  }) => (
    <div className='sidebar'>
      <div className='sidebar-header'>
        <div className='logo'></div>
        <h1>Intender</h1>
      </div>
      <nav className='sidebar-nav'>
        <button
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings', setActiveTab)}
        >
          Settings
        </button>
        <button
          className={`tab-btn ${activeTab === 'about' ? 'active' : ''}`}
          onClick={() => onTabChange('about', setActiveTab)}
        >
          About
        </button>
      </nav>
    </div>
  )
);

const Options = () => {
  const [activeTab, setActiveTab] = useState<Tab>('settings');

  const handleTabChange = (newTab: Tab, setActiveTab: (tab: Tab) => void) => {
    // For now, just allow the tab change
    // The warning logic will be handled in the SettingsTab component
    setActiveTab(newTab);
  };

  return (
    <div className='options-container'>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onTabChange={handleTabChange}
      />

      <div className='content'>
        {activeTab === 'settings' && (
          <SettingsTab setActiveTab={setActiveTab} />
        )}
        {activeTab === 'about' && <AboutTab />}
      </div>

      <div
        className='build-footer'
        title={BUILD_HASH}
        onClick={() => {
          navigator.clipboard.writeText(`${BUILD_VERSION} - ${BUILD_HASH}`);
        }}
      >
        v{BUILD_VERSION}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<Options />);

root.render(<Options />);
