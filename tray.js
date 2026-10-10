// tray.js — 系統匣（ba-wallpaper-mode 計畫 W1）
// 顯示播放器／桌布啟停／互動模式／開機自啟／離開；狀態變更即重建選單。
'use strict';
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const wallpaper = require('./wallpaper');

let tray = null;

function zh() { return String(app.getLocale() || '').toLowerCase().startsWith('zh'); }

function iconImage() {
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

function buildMenu(showPlayer) {
  const t = (z, e) => (zh() ? z : e);
  let s;
  try { s = wallpaper.status(); } catch { s = { active: false, config: {}, autostart: false }; }
  const menu = Menu.buildFromTemplate([
    { label: t('顯示播放器', 'Show Player'), click: () => { try { showPlayer(); } catch {} } },
    { type: 'separator' },
    s.active
      ? { label: t('停止桌布', 'Stop Wallpaper'), click: () => { try { wallpaper.stop(); } catch {} } }
      : { label: t('啟動桌布', 'Start Wallpaper'), click: () => { try { wallpaper.start(); } catch {} } },
    {
      label: t('互動模式（可點擊桌布）', 'Interactive (clickable)'),
      type: 'checkbox',
      checked: !!(s.config && s.config.interact),
      enabled: !!s.active,
      click: (mi) => { try { wallpaper.setConfig({ interact: mi.checked }); } catch {} },
    },
    {
      label: t('開機自啟（桌布）', 'Launch at Login (Wallpaper)'),
      type: 'checkbox',
      checked: !!s.autostart,
      click: (mi) => { try { wallpaper.setAutostart(mi.checked); } catch {} },
    },
    { type: 'separator' },
    {
      label: t('離開', 'Quit'),
      click: () => { try { wallpaper.shutdown(); } catch {} app.quit(); },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('BA Memorial Lobby' + (s.active ? (s.paused ? ' ⏸' : ' 🖼') : ''));
}

function createTray({ showPlayer }) {
  if (tray) return tray;
  try {
    tray = new Tray(iconImage());
  } catch (e) {
    console.error('[tray] create failed:', e.message);
    tray = null;
    return null;
  }
  buildMenu(showPlayer);
  wallpaper.onState(() => {
    if (tray && !tray.isDestroyed()) {
      try { buildMenu(showPlayer); } catch {}
    }
  });
  return tray;
}

module.exports = { createTray };
