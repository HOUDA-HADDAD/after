import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal typings for the Web Speech API.
 *
 * It is not in TypeScript's DOM library because it is not a finished standard, and it is not in
 * every browser either — which is the whole reason this hook feature-detects rather than assumes.
 * Only the parts actually used are declared; inventing the rest would imply a guarantee the
 * browser does not give.
 */
interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { readonly length: number; [index: number]: SpeechRecognitionResult };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const recognitionConstructor = (): SpeechRecognitionConstructor | null => {
  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
};

export interface Dictation {
  /** False in Firefox and anywhere else without the API — the button is then never rendered. */
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * Speak instead of type.
 *
 * Feature-detected, never polyfilled: a mic button that does nothing is worse than no mic button,
 * and every other way to write a text still works. Interim results stream in as they arrive so
 * the player can see it working and edit afterwards — dictation produces a draft, not a
 * commitment.
 *
 * `onTranscript` receives the text recognised since the last call, which the caller appends. The
 * hook deliberately owns no text of its own: the textarea stays the single source of truth, so
 * typing and speaking cannot disagree about what the player wrote.
 */
export function useDictation(onTranscript: (chunk: string) => void): Dictation {
  const [supported] = useState(() => recognitionConstructor() !== null);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const callback = useRef(onTranscript);

  useEffect(() => {
    callback.current = onTranscript;
  });

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Recognition = recognitionConstructor();

    if (Recognition === null) return;

    const instance = new Recognition();

    instance.lang = navigator.language;
    instance.continuous = true;
    instance.interimResults = true;

    instance.onresult = (event) => {
      let chunk = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];

        if (result?.isFinal === true) chunk += result[0]?.transcript ?? '';
      }

      if (chunk !== '') callback.current(chunk);
    };

    // A refused microphone permission ends the session; the button returning to its resting state
    // is the honest signal, and the player can still type.
    instance.onerror = () => {
      setListening(false);
    };
    instance.onend = () => {
      setListening(false);
    };

    recognition.current = instance;
    instance.start();
    setListening(true);
  }, []);

  // Leaving the screen with the microphone open would keep listening to a room nobody is playing
  // in any more.
  useEffect(
    () => () => {
      recognition.current?.abort();
    },
    [],
  );

  return { supported, listening, start, stop };
}
