import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { KindeAccountEntry } from '../../src/components/UI/KindeAccountEntry';
import { GlobalDialog } from '../../src/components/UI/GlobalDialog';

const root = document.createElement('div');
document.body.append(root);
createRoot(root).render(createElement(Fragment, null,
    createElement(KindeAccountEntry, {
        candidateMode: 'fitness', candidateActivityEnabled: document.body.hasAttribute('data-candidate-activity'),
    }),
    createElement(GlobalDialog),
));
