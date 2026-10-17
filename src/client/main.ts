import { rack } from '../shared/table.ts';
import { createScene } from './scene.ts';

const scene = createScene(document.getElementById('c') as HTMLCanvasElement);
scene.setBalls(rack());
scene.setCue(true, 0, 0.3);
scene.setCamera(location.search.includes('aim') ? 'aim' : 'top', 0);
