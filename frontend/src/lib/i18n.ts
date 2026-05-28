import { useState, useEffect } from 'react';

type Translations = Record<string, string>;

const cs: Translations = {
  // Auth
  'auth.login': 'Přihlášení k Aegis Hub',
  'auth.register': 'Nová registrace',
  'auth.username': 'Uživatelské jméno',
  'auth.password': 'Heslo',
  'auth.loginBtn': 'Přihlásit se',
  'auth.registerBtn': 'Vytvořit účet',
  'auth.toggleReg': 'Nemáte účet? Zaregistrovat',
  'auth.toggleLog': 'Zpět na přihlášení',
  
  // Nav
  'nav.passwords': 'Hesla',
  'nav.notes': 'Poznámky',
  'nav.bookmarks': 'Záložky',
  'nav.files': 'Soubory',
  'nav.chat': 'Chat',
  'nav.admin': 'Administrace',
  'nav.logout': 'Odhlásit',

  // Chat
  'chat.channels': 'Kanály',
  'chat.dms': 'Přímé zprávy',
  'chat.typeMsg': 'Zpráva pro...',
  'chat.deleteConfirm': 'Opravdu smazat tuto zprávu pro všechny?',
  'chat.e2eEncrypted': 'E2E Šifrováno',
  
  // Settings/Profile
  'settings.title': 'Nastavení profilu',
  'settings.language': 'Jazyk (Language)',
  'settings.save': 'Uložit',
};

const en: Translations = {
  // Auth
  'auth.login': 'Login to Aegis Hub',
  'auth.register': 'Create Account',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.loginBtn': 'Sign In',
  'auth.registerBtn': 'Sign Up',
  'auth.toggleReg': 'Need an account? Register',
  'auth.toggleLog': 'Back to Login',
  
  // Nav
  'nav.passwords': 'Passwords',
  'nav.notes': 'Notes',
  'nav.bookmarks': 'Bookmarks',
  'nav.files': 'Files',
  'nav.chat': 'Chat',
  'nav.admin': 'Admin Area',
  'nav.logout': 'Logout',

  // Chat
  'chat.channels': 'Channels',
  'chat.dms': 'Direct Messages',
  'chat.typeMsg': 'Message...',
  'chat.deleteConfirm': 'Delete this message for everyone?',
  'chat.e2eEncrypted': 'E2E Encrypted',
  
  // Settings/Profile
  'settings.title': 'Profile Settings',
  'settings.language': 'Language',
  'settings.save': 'Save',
};

const dicts: Record<string, Translations> = { cs, en };

let currentLang = localStorage.getItem('aegis_lang') || 'cs';
if (!dicts[currentLang]) currentLang = 'en';

const listeners = new Set<() => void>();

export const setLanguage = (lang: string) => {
  if (dicts[lang]) {
    currentLang = lang;
    localStorage.setItem('aegis_lang', lang);
    listeners.forEach(fn => fn());
  }
};

export const getLanguage = () => currentLang;

export const t = (key: string): string => {
  return dicts[currentLang]?.[key] || key;
};

export function useI18n() {
  const [, setTick] = useState(0);
  
  useEffect(() => {
    const fn = () => setTick(n => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  return { t, setLanguage, currentLang };
}
