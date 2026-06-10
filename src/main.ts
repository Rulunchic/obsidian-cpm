import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting } from "obsidian";
import { EditorView } from "@codemirror/view";

interface Sample {
  time: number;
  totalChars: number;
  totalWords: number;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

interface CPMSettings {
  windowSeconds: number;
  idleTimeoutMs: number;
  showWhenIdle: boolean;
  refreshIntervalMs: number;
}

const DEFAULT_SETTINGS: CPMSettings = {
  windowSeconds: 3,
  idleTimeoutMs: 2000,
  showWhenIdle: false,
  refreshIntervalMs: 50,
};

export default class CPMMeter extends Plugin {
  settings: CPMSettings;
  private overlay: HTMLDivElement;
  private samples: Sample[] = [];
  private lastTyped: number = 0;
  private cpm: number = 0;
  private wpm: number = 0;
  private visible: boolean = false;
  private activeEditor: Editor | null = null;
  private activeView: MarkdownView | null = null;
  private idleTimer: number | null = null;
  private refreshTimer: number | null = null;

  async onload() {
    await this.loadSettings();

    this.overlay = createDiv({ cls: "cpm-overlay" });
    this.overlay.setText("0 CPM · 0 WPM");
    document.body.appendChild(this.overlay);

    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        if (info instanceof MarkdownView) {
          this.handleEditorChange(editor, info);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.hide();
        this.samples = [];
      })
    );

    this.addSettingTab(new CPMSettingTab(this.app, this));
  }

  onunload() {
    this.hide();
    this.overlay.remove();
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
    }
  }

  private handleEditorChange(editor: Editor, view: MarkdownView) {
    this.activeEditor = editor;
    this.activeView = view;
    this.lastTyped = Date.now();

    const text = editor.getValue();
    const totalChars = text.length;
    const totalWords = countWords(text);
    this.samples.push({ time: this.lastTyped, totalChars, totalWords });

    const cutoff = this.lastTyped - this.settings.windowSeconds * 1000;
    while (this.samples.length > 1 && this.samples[1].time < cutoff) {
      this.samples.shift();
    }

    if (this.samples.length >= 2) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      const elapsed = (last.time - first.time) / 1000;
      const charsDiff = last.totalChars - first.totalChars;
      const wordsDiff = last.totalWords - first.totalWords;
      if (elapsed > 0.1) {
        this.cpm = Math.round(charsDiff / elapsed * 60);
        this.wpm = Math.round(wordsDiff / elapsed * 60);
      }
    }

    this.show();
    this.updatePosition(editor);

    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
    }
    this.idleTimer = window.setTimeout(() => {
      this.samples = [];
      if (!this.settings.showWhenIdle) {
        this.hide();
      } else {
        this.cpm = 0;
        this.wpm = 0;
        this.updateOverlayText();
      }
    }, this.settings.idleTimeoutMs);
  }

  private show() {
    if (!this.visible) {
      this.visible = true;
      this.overlay.style.display = "block";
      if (this.refreshTimer === null) {
        this.refreshTimer = window.setInterval(() => {
          if (this.activeEditor && this.visible) {
            this.updatePosition(this.activeEditor);
          }
        }, this.settings.refreshIntervalMs);
      }
    }
    this.updateOverlayText();
  }

  private hide() {
    this.visible = false;
    this.overlay.style.display = "none";
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private updateOverlayText() {
    if (this.cpm > 0) {
      this.overlay.setText(`${this.cpm} CPM · ${this.wpm} WPM`);
    } else if (this.settings.showWhenIdle) {
      this.overlay.setText("0 CPM · 0 WPM");
    }
  }

  private updatePosition(editor: Editor) {
    const cm = (editor as any).cm as EditorView | undefined;
    if (!cm) return;

    const cursor = editor.getCursor();
    const offset = editor.posToOffset(cursor);
    const coords = cm.coordsAtPos(offset);

    if (coords) {
      const top = coords.top - this.overlay.offsetHeight - 6;
      this.overlay.style.top = `${Math.max(0, top)}px`;
      this.overlay.style.left = `${coords.left}px`;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class CPMSettingTab extends PluginSettingTab {
  plugin: CPMMeter;

  constructor(app: App, plugin: CPMMeter) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "CPM Meter — настройки" });

    new Setting(containerEl)
      .setName("Окно усреднения (сек)")
      .setDesc("За сколько секунд усреднять скорость печати")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.windowSeconds))
          .onChange(async (val) => {
            const n = parseInt(val);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.windowSeconds = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Таймаут бездействия (мс)")
      .setDesc("Через сколько мс после последнего нажатия прятать индикатор")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.idleTimeoutMs))
          .onChange(async (val) => {
            const n = parseInt(val);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.idleTimeoutMs = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Показывать при бездействии")
      .setDesc("Показывать «0 CPM» когда не печатаете")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showWhenIdle)
          .onChange(async (val) => {
            this.plugin.settings.showWhenIdle = val;
            await this.plugin.saveSettings();
          })
      );
  }
}
