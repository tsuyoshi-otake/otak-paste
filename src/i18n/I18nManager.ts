import * as fs from 'fs';
import * as path from 'path';
import { I18nConfig, SupportedLocale, TranslationMessages } from './types';

export const supportedLocales: readonly SupportedLocale[] = [
    'en',
    'ja',
    'zh-cn',
    'zh-tw',
    'ko',
    'vi',
    'es',
    'pt-br',
    'fr',
    'de',
    'hi',
    'id',
    'it',
    'ru',
    'ar',
    'tr'
];

export const defaultI18nConfig: I18nConfig = {
    defaultLocale: 'en',
    fallbackLocale: 'en',
    supportedLocales
};

export class I18nManager {
    private currentLocale: SupportedLocale;
    private messages: TranslationMessages = {};
    private fallbackMessages: TranslationMessages = {};

    public constructor(
        private readonly localesDir: string,
        private readonly config: I18nConfig = defaultI18nConfig
    ) {
        this.currentLocale = config.defaultLocale;
    }

    public initialize(rawLocale: string): void {
        this.currentLocale = resolveSupportedLocale(rawLocale, this.config) ?? this.config.fallbackLocale;
        this.messages = this.loadLocaleFile(this.currentLocale);
        this.fallbackMessages = this.currentLocale === this.config.fallbackLocale
            ? this.messages
            : this.loadLocaleFile(this.config.fallbackLocale);
    }

    public t(key: string, params?: Record<string, string>): string {
        const message = this.messages[key] ?? this.fallbackMessages[key] ?? key;
        return params ? substituteParams(message, params) : message;
    }

    public getCurrentLocale(): SupportedLocale {
        return this.currentLocale;
    }

    private loadLocaleFile(locale: SupportedLocale): TranslationMessages {
        const localePath = path.join(this.localesDir, `${locale}.json`);
        return JSON.parse(fs.readFileSync(localePath, 'utf8')) as TranslationMessages;
    }
}

export function normalizeLocale(locale: string): string {
    return locale.trim().replace(/_/g, '-').toLowerCase();
}

export function resolveSupportedLocale(
    rawLocale: string,
    config: I18nConfig = defaultI18nConfig
): SupportedLocale | null {
    const locale = normalizeLocale(rawLocale);
    if (isSupportedLocale(locale, config)) {
        return locale;
    }

    const base = locale.split('-')[0];
    if (isSupportedLocale(base, config)) {
        return base;
    }

    if (base === 'pt' && isSupportedLocale('pt-br', config)) {
        return 'pt-br';
    }

    if (base === 'zh') {
        const isTraditional = locale.includes('hant') ||
            locale.includes('tw') ||
            locale.includes('hk') ||
            locale.includes('mo');
        const preferred = isTraditional ? 'zh-tw' : 'zh-cn';
        return isSupportedLocale(preferred, config) ? preferred : null;
    }

    return null;
}

function isSupportedLocale(locale: string, config: I18nConfig): locale is SupportedLocale {
    return config.supportedLocales.includes(locale as SupportedLocale);
}

function substituteParams(message: string, params: Record<string, string>): string {
    let result = message;
    for (const [key, value] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g'), value);
    }
    return result;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
