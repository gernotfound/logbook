import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { KindeAccountEntry } from '../../src/components/UI/KindeAccountEntry';

const root = document.createElement('div');
document.body.append(root);
createRoot(root).render(createElement(KindeAccountEntry, { candidateMode: 'fitness' }));
