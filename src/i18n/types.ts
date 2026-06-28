export type SupportedLocale =
    | 'en'
    | 'ja'
    | 'zh-cn'
    | 'zh-tw'
    | 'ko'
    | 'vi'
    | 'es'
    | 'pt-br'
    | 'fr'
    | 'de'
    | 'hi'
    | 'id'
    | 'it'
    | 'ru'
    | 'ar'
    | 'tr';

export interface TranslationMessages {
    [key: string]: string;
}

export interface I18nConfig {
    defaultLocale: SupportedLocale;
    fallbackLocale: SupportedLocale;
    supportedLocales: readonly SupportedLocale[];
}
