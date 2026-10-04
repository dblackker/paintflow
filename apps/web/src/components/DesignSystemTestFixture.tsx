import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Button } from './Button';
import { FormValidationProvider } from './FormValidation';
import { Icon } from './Icon';
import { Input, Select, Textarea } from './Input';
import { Modal, ModalFooter } from './Modal';
import '../styles/index.css';

// Loaded only by browser tests through an intercepted fixture URL, never by an app route.
function DesignSystemTestFixture() {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitted, setSubmitted] = useState(0);
  const [clicks, setClicks] = useState(0);

  return (
    <div style={{ minHeight: '200vh', padding: 16, transform: 'translateZ(0)' }}>
      <header style={{ position: 'fixed', top: 0, right: 0, left: 0, height: 64, zIndex: 999, background: 'white' }}>Fixture header</header>
      <main style={{ marginTop: 64, maxWidth: 640 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => setOpen(true)}>Open form</Button>
          <Button variant="secondary" onClick={() => setLoading((value) => !value)}>Toggle loading</Button>
          <Button variant="ghost" onClick={() => setShowErrors((value) => !value)}>Toggle errors</Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <Button as="a" href="/internal-fixture-destination" disabled isLoading={loading} onClick={() => setClicks((value) => value + 1)}>Disabled internal link</Button>
          <Button as="a" href="https://example.invalid/disabled" target="_blank" disabled onClick={() => setClicks((value) => value + 1)}>Disabled external link</Button>
          <Button isLoading={loading} onClick={() => setClicks((value) => value + 1)}>Save changes</Button>
          <Button isLoading={loading} leftIcon={<Icon name="plus" />} onClick={() => setClicks((value) => value + 1)}>Add item</Button>
          <button type="button" className="btn-icon" aria-label="Edit item"><Icon name="edit" /></button>
        </div>
        <p data-testid="action-count">{clicks}</p>
        <p data-testid="submission-count">{submitted}</p>
        <p id="external-description">Additional context.</p>
        <Input id="fixture-company" label="Company" helperText="Your business name." error={showErrors ? 'Enter a company name.' : undefined} aria-describedby="external-description external-description" />
        <Textarea id="fixture-notes" label="Notes" error={showErrors ? 'Check the notes.' : undefined} />
        <Select id="fixture-role" label="Role" error={showErrors ? 'Choose a role.' : undefined} options={[{ value: '', label: 'Choose role' }]} />
      </main>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Review crew time" description="Synthetic component fixture" size="lg">
        <form onSubmit={(event) => { event.preventDefault(); setSubmitted((value) => value + 1); }}>
          <Input id="fixture-email" type="email" label="Work email" required labelHelp="Use the address where the crew member receives work updates." />
          <Button type="button" variant="secondary" onClick={() => setNested(true)}>Open nested dialog</Button>
          {Array.from({ length: 8 }, (_, index) => <Input key={index} label={`Field ${index + 1}`} />)}
          <Input label="Final field" />
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Submit form</Button>
          </ModalFooter>
        </form>
        <Modal isOpen={nested} onClose={() => setNested(false)} title="Nested confirmation" size="sm">
          <Input label="Nested field" />
          <ModalFooter><Button type="button" onClick={() => setNested(false)}>Done</Button></ModalFooter>
        </Modal>
      </Modal>
    </div>
  );
}

export function mountDesignSystemTestFixture() {
  if (!import.meta.env.DEV) throw new Error('Design-system fixture is development-only.');
  const root = document.getElementById('root');
  if (!root) throw new Error('Fixture root is missing.');
  createRoot(root).render(
    <StrictMode><MemoryRouter><FormValidationProvider><DesignSystemTestFixture /></FormValidationProvider></MemoryRouter></StrictMode>,
  );
}
