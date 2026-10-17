import { expect, test } from 'vitest';
import { videoId } from '../src/client/youtube.ts';

test('videoId: the usual YouTube links and the bare id', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?list=x&v=dQw4w9WgXcQ&t=10',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/live/dQw4w9WgXcQ',
    ' dQw4w9WgXcQ ',
  ])
    expect(videoId(link)).toBe('dQw4w9WgXcQ');
  expect(videoId('https://example.com/qualquer')).toBeNull();
});
