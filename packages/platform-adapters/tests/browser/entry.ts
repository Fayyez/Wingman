import * as wa from '../../src/whatsapp-web';
(window as unknown as { __wingman: typeof wa }).__wingman = wa;
