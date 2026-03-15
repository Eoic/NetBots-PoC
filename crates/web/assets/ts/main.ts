import '../scss/style.scss';
import { bootstrap } from './app';

void bootstrap().catch((err) => {
    console.error('Failed to bootstrap app:', err);
});
