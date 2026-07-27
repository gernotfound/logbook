import { render } from '@testing-library/react';
import App from './App';
import { expect, test } from 'vitest';

test('renders App without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeTruthy();
});
