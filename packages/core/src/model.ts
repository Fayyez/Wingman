/** Platform-neutral conversation model (docs/03-system-design.md §2.1). */

export type PlatformId =
  | 'whatsapp_web'
  | 'instagram_web'
  | 'android_wa'
  | 'android_ig'
  | 'ios_share'
  | (string & {});

export interface ChatRef {
  platform: PlatformId;
  /** Raw platform id. Never sent to the server. */
  platformChatId: string;
  /** HMAC(installSecret, platform + platformChatId). Safe to send to the server. */
  chatKey: string;
  /** Contact display name. Local only. */
  title: string;
  isGroup: boolean;
}

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'voice'
  | 'sticker'
  | 'gif'
  | 'link'
  | 'deleted'
  | 'system'
  | 'story_reply'
  | 'reel_share'
  | 'unknown';

export type Direction = 'in' | 'out';

export interface NormalizedMessage {
  /** Platform message id, or a stable hash when the platform exposes none. */
  id: string;
  chatKey: string;
  dir: Direction;
  kind: MessageKind;
  /** '' for pure media; caption if any. */
  text: string;
  /** ISO timestamp, best effort (platforms often expose minute precision). */
  ts: string | null;
  /** Sender name as shown by the platform (useful in groups). Local only. */
  sender?: string;
  replyToId?: string;
  reactions?: string[];
  meta?: { durationSec?: number; edited?: boolean };
}

export type Tone =
  | 'chill'
  | 'playful'
  | 'flirty'
  | 'sweet'
  | 'sincere'
  | 'funny'
  | 'apologetic'
  | 'confident';

export type Objective =
  | 'keep_going'
  | 'build_rapport'
  | 'deepen'
  | 'flirt_up'
  | 'ask_out'
  | 'recover'
  | 'slow_down'
  | 'end_gracefully';

export type Length = 'one_liner' | 'short' | 'normal';
export type LanguageMix = 'auto' | 'more_urdu_hindi' | 'more_english';
export type SuggestMode = 'auto' | 'reply' | 'topic' | 'guide' | 'rewrite';
export type Stage = 'just_matched' | 'talking' | 'close' | 'dating' | 'friend';
export type Tweak =
  | 'shorter'
  | 'longer'
  | 'funnier'
  | 'more_flirty'
  | 'less_flirty'
  | 'more_urdu_hindi'
  | 'more_english'
  | 'more_casual'
  | 'more_sincere';

export interface Controls {
  tone?: Tone;
  objective?: Objective;
  length?: Length;
  language?: LanguageMix;
  count?: 1 | 2 | 3;
}
