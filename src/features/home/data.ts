import type { Track } from '../../core/types/track';

export interface CardItem {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  artworkUri?: string;
  tracks?: readonly Track[];
}

export interface VideoItem {
  id: string;
  title: string;
  artist: string;
  views: string;
  thumbnailUri?: string;
}

export const quickPicks: readonly Track[] = [
  {
    id: 'tVlcKp3bWH8',
    title: 'Haseen',
    artist: 'Talwinder • Single',
    artworkUri: 'https://i.ytimg.com/vi/tVlcKp3bWH8/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: '4tywp83zkmk',
    title: 'Cheques',
    artist: 'Shubh • Still Rollin',
    artworkUri: 'https://i.ytimg.com/vi/4tywp83zkmk/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'XO8wew38VM8',
    title: 'Millionaire',
    artist: 'Yo Yo Honey Singh • GLORY',
    artworkUri: 'https://i.ytimg.com/vi/XO8wew38VM8/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'LK7-_dgAVQE',
    title: 'Tauba Tauba',
    artist: 'Karan Aujla • Bad Newz',
    artworkUri: 'https://i.ytimg.com/vi/LK7-_dgAVQE/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'hOHKltAiKXQ',
    title: 'Big Dawgs',
    artist: 'Hanumankind, Kalmi',
    artworkUri: 'https://i.ytimg.com/vi/hOHKltAiKXQ/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'cWMxCE2HTag',
    title: 'Softly',
    artist: 'Karan Aujla, Ikky',
    artworkUri: 'https://i.ytimg.com/vi/cWMxCE2HTag/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'BddP6PYo2gs',
    title: 'Kesariya',
    artist: 'Arijit Singh, Pritam',
    artworkUri: 'https://i.ytimg.com/vi/BddP6PYo2gs/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'gVYpkmGz7cI',
    title: 'Husn',
    artist: 'Anuv Jain • Single',
    artworkUri: 'https://i.ytimg.com/vi/gVYpkmGz7cI/hqdefault.jpg',
    origin: 'online',
  },
];

export const coversAndRemixes: readonly Track[] = [
  {
    id: 'bZl8v2e3r9E',
    title: 'Jhoom (R&B Mix)',
    artist: 'Ali Zafar • Lo-Fi Mix',
    artworkUri: 'https://i.ytimg.com/vi/bZl8v2e3r9E/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'ApXoWvfEYVU',
    title: 'Sunflower',
    artist: 'Post Malone, Swae Lee',
    artworkUri: 'https://i.ytimg.com/vi/ApXoWvfEYVU/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: '34Na4j8AVgA',
    title: 'Starboy',
    artist: 'The Weeknd, Daft Punk',
    artworkUri: 'https://i.ytimg.com/vi/34Na4j8AVgA/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: '3IIspaicSnY',
    title: 'One Dance',
    artist: 'Drake • Views',
    artworkUri: 'https://i.ytimg.com/vi/3IIspaicSnY/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'VNs_cCtdbPc',
    title: 'No Love',
    artist: 'Shubh • Single',
    artworkUri: 'https://i.ytimg.com/vi/VNs_cCtdbPc/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: '1pnmyW_iEms',
    title: 'Baller',
    artist: 'Shubh, Ikky',
    artworkUri: 'https://i.ytimg.com/vi/1pnmyW_iEms/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'ElZfdU54Cp8',
    title: 'Apna Bana Le',
    artist: 'Arijit Singh, Sachin-Jigar',
    artworkUri: 'https://i.ytimg.com/vi/ElZfdU54Cp8/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'RLzC55ai0eo',
    title: 'Baarishein',
    artist: 'Anuv Jain • Acoustic',
    artworkUri: 'https://i.ytimg.com/vi/RLzC55ai0eo/hqdefault.jpg',
    origin: 'online',
  },
];

export const heardInShorts: readonly Track[] = [
  {
    id: 'ws00PzFk0n0',
    title: 'Soulmate',
    artist: 'Badshah, Arijit Singh',
    artworkUri: 'https://i.ytimg.com/vi/ws00PzFk0n0/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'f94y5kU1F1s',
    title: 'Winning Speech',
    artist: 'Karan Aujla, Mxrci',
    artworkUri: 'https://i.ytimg.com/vi/f94y5kU1F1s/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'gh3FyLT7Vvg',
    title: 'O Maahi',
    artist: 'Arijit Singh, Pritam',
    artworkUri: 'https://i.ytimg.com/vi/gh3FyLT7Vvg/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'IJq0yyWug1k',
    title: 'Tum Hi Ho',
    artist: 'Arijit Singh • Aashiqui 2',
    artworkUri: 'https://i.ytimg.com/vi/IJq0yyWug1k/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'nSgC_TqjB9Y',
    title: 'Gul',
    artist: 'Anuv Jain • Single',
    artworkUri: 'https://i.ytimg.com/vi/nSgC_TqjB9Y/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'EeqwNff_Bq4',
    title: 'Alag Aasmaan',
    artist: 'Anuv Jain • Single',
    artworkUri: 'https://i.ytimg.com/vi/EeqwNff_Bq4/hqdefault.jpg',
    origin: 'online',
  },
];

export const trendingPlaylists = {
  id: 'tp-1',
  title: 'Long Drive Hits',
  curator: 'Aero Music',
  meta: 'Top Punjabi & Bollywood Mix',
  topTracks: [
    {
      id: 'LK7-_dgAVQE',
      title: 'Tauba Tauba',
      artist: 'Karan Aujla',
      artworkUri: 'https://i.ytimg.com/vi/LK7-_dgAVQE/hqdefault.jpg',
      origin: 'online' as const,
    },
    {
      id: '4tywp83zkmk',
      title: 'Cheques',
      artist: 'Shubh',
      artworkUri: 'https://i.ytimg.com/vi/4tywp83zkmk/hqdefault.jpg',
      origin: 'online' as const,
    },
    {
      id: 'tVlcKp3bWH8',
      title: 'Haseen',
      artist: 'Talwinder',
      artworkUri: 'https://i.ytimg.com/vi/tVlcKp3bWH8/hqdefault.jpg',
      origin: 'online' as const,
    },
  ],
};

export const dancingMoods: readonly CardItem[] = [
  {
    id: 'dm-1',
    title: 'Bollywood Dance Hits',
    subtitle: 'Badshah, Neha Kakkar',
    badge: 'Dance',
    artworkUri: 'https://i.ytimg.com/vi/LK7-_dgAVQE/hqdefault.jpg',
  },
  {
    id: 'dm-2',
    title: 'Punjabi Party Anthem',
    subtitle: 'Diljit Dosanjh, Karan Aujla',
    badge: 'Party',
    artworkUri: 'https://i.ytimg.com/vi/cWMxCE2HTag/hqdefault.jpg',
  },
  {
    id: 'dm-3',
    title: 'Desi EDM & Bass',
    subtitle: 'Nucleya, Lost Stories',
    badge: 'Bass',
    artworkUri: 'https://i.ytimg.com/vi/hOHKltAiKXQ/hqdefault.jpg',
  },
];

export const albumsForYou: readonly CardItem[] = [
  {
    id: 'af-1',
    title: 'Still Rollin',
    subtitle: 'Album • Shubh',
    artworkUri: 'https://i.ytimg.com/vi/4tywp83zkmk/hqdefault.jpg',
  },
  {
    id: 'af-2',
    title: 'GLORY',
    subtitle: 'Album • Yo Yo Honey Singh',
    artworkUri: 'https://i.ytimg.com/vi/XO8wew38VM8/hqdefault.jpg',
  },
  {
    id: 'af-3',
    title: 'Making Memories',
    subtitle: 'Album • Karan Aujla, Ikky',
    artworkUri: 'https://i.ytimg.com/vi/cWMxCE2HTag/hqdefault.jpg',
  },
];

export const trendingSongs: readonly Track[] = [
  {
    id: 'XO8wew38VM8',
    title: 'Millionaire',
    artist: 'Yo Yo Honey Singh • GLORY',
    artworkUri: 'https://i.ytimg.com/vi/XO8wew38VM8/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'LK7-_dgAVQE',
    title: 'Tauba Tauba',
    artist: 'Karan Aujla',
    artworkUri: 'https://i.ytimg.com/vi/LK7-_dgAVQE/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'hOHKltAiKXQ',
    title: 'Big Dawgs',
    artist: 'Hanumankind',
    artworkUri: 'https://i.ytimg.com/vi/hOHKltAiKXQ/hqdefault.jpg',
    origin: 'online',
  },
  {
    id: 'tVlcKp3bWH8',
    title: 'Haseen',
    artist: 'Talwinder',
    artworkUri: 'https://i.ytimg.com/vi/tVlcKp3bWH8/hqdefault.jpg',
    origin: 'online',
  },
];
