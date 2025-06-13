import { merge } from 'es-toolkit/compat'

import userConfig from './config.json'

export interface SiteConfig {
  name: string
  title: string
  description: string
  url: string
  accentColor: string
  author: Author
  social?: Social
  feed?: Feed
}

interface Feed {
  folo?: {
    challenge?: {
      feedId: string
      userId: string
    }
  }
}
interface Author {
  name: string
  url: string
  avatar?: string
}
interface Social {
  twitter: string
  github: string
}

const defaultConfig: SiteConfig = {
  name: "David's Photo Gallery",
  title: "David's Photo Gallery",
  description:
    'Capturing moments in life.',
  url: 'https://afilmory.vercel.app/',
  accentColor: '#007bff',
  author: {
    name: 'David',
    url: 'https://davidweng.eu.org/',
    avatar: 'https://avatars.githubusercontent.com/u/95214375?v=4',
  },
  social: {
    twitter: '@thedavidweng',
    github: 'thedavidweng',
  },
}
export const siteConfig: SiteConfig = merge(defaultConfig, userConfig) as any

export default siteConfig
