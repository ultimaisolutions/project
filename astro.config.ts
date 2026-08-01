import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import clerk from '@clerk/astro';
import { heIL } from '@clerk/localizations';
import { dark } from '@clerk/ui/themes';

export default defineConfig({
  output: 'server',
  devToolbar: {
    enabled: false,
  },
  integrations: [clerk({ localization: heIL, appearance: { theme: dark, variables: { colorPrimary: '#22D3EE', colorBackground: '#0D1B2A', colorText: '#F4F8FC', colorTextSecondary: '#A9B9C9', colorInputBackground: '#122337', colorInputText: '#F4F8FC', borderRadius: '10px' } } }), react()],
  adapter: vercel({
    imageService: true,
    maxDuration: 300,
    webAnalytics: {
      enabled: true,
    },
  }),
});
