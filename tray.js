// tray.js — 系統匣（ba-wallpaper-mode 計畫 W1）
// 顯示播放器／桌布啟停／互動模式／開機自啟／離開；狀態變更即重建選單。
'use strict';
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const wallpaper = require('./wallpaper');
const { mainT } = require('./main-i18n');

let tray = null;

function iconImage() {
  // macOS：狀態列需 16/32pt template（黑+alpha；「Template」後綴自動標記＋@2x 自動配對）
  // ——彩色大圖（深藍底 app icon）在深色選單列會整顆隱形
  if (process.platform === 'darwin') {
    try {
      const p = path.join(__dirname, 'build', 'trayTemplate.png');
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) { img.setTemplateImage(true); return img; }
      }
    } catch {}
  }
  const candidates = [
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, 'favicon.ico'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    } catch {}
  }
  return nativeImage.createEmpty();
}

function buildMenu(showPlayer, onOpenWallpaperSettings) {
  const t = (key) => mainT(key);
  let s;
  try { s = wallpaper.status(); } catch { s = { active: false, config: {}, autostart: false }; }
  const menu = Menu.buildFromTemplate([
    { label: t('tray.showPlayer'), click: () => { try { showPlayer(); } catch {} } },
    { type: 'separator' },
    s.active
      ? { label: t('tray.stopWallpaper'), click: () => { try { wallpaper.stop(); } catch {} } }
      : { label: t('tray.startWallpaper'), click: () => { try { wallpaper.start(); } catch {} } },
    {
      label: t('tray.chooseLobby'),
      enabled: !!s.active,
      click: () => { try { onOpenWallpaperSettings && onOpenWallpaperSettings(); } catch {} },
    },
    {
      label: t('tray.interactive'),
      type: 'checkbox',
      checked: !!(s.config && s.config.interact),
      enabled: !!s.active,
      click: (mi) => { try { wallpaper.setConfig({ interact: mi.checked }); } catch {} },
    },
    {
      label: t('tray.launchAtLogin'),
      type: 'checkbox',
      checked: !!s.autostart,
      click: (mi) => { try { wallpaper.setAutostart(mi.checked); } catch {} },
    },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: () => { try { wallpaper.shutdown(); } catch {} app.quit(); },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('BA Memorial Lobby' + (s.active ? (s.paused ? ' ⏸' : ' 🖼') : ''));
}

function createTray({ showPlayer, onOpenWallpaperSettings }) {
  if (tray) return tray;
  try {
    tray = new Tray(iconImage());
  } catch (e) {
    console.error('[tray] create failed:', e.message);
    tray = null;
    return null;
  }
  buildMenu(showPlayer, onOpenWallpaperSettings);
  wallpaper.onState(() => {
    if (tray && !tray.isDestroyed()) {
      try { buildMenu(showPlayer, onOpenWallpaperSettings); } catch {}
    }
  });
  return tray;
}

// 語言變更（renderer 送的 set-ui-lang）→ 重建選單文字
function refreshTray(showPlayer, onOpenWallpaperSettings) {
  if (!tray || tray.isDestroyed()) return;
  try { buildMenu(showPlayer, onOpenWallpaperSettings); } catch {}
}

module.exports = { createTray, refreshTray };
