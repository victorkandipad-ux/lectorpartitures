import {
  createAppleSplashScreens,
  defineConfig,
  minimal2023Preset,
} from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    appleSplashScreens: createAppleSplashScreens(
      {
        padding: 0.4,
        resizeOptions: { background: '#1f2a44', fit: 'contain' },
        linkMediaOptions: { log: false, addMediaScreen: true, xhtml: false },
        png: { compressionLevel: 9, quality: 60 },
        name: (landscape, size, dark) =>
          `apple-splash-${landscape ? 'landscape' : 'portrait'}-${dark ? 'dark-' : ''}${size.width}x${size.height}.png`,
      },
      // Only iPhones (iOS 17+) – keeps the precache small.
      ['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone Air', 'iPhone 16 Plus', 'iPhone 16e', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 14 Plus', 'iPhone 13', 'iPhone 13 mini', 'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11', 'iPhone 8 Plus', 'iPhone 8'],
    ),
  },
  images: ['public/icon.svg'],
})
