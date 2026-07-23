import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { Layout } from './components/Layout';

export default function App() {
  return (
    <WorkspaceProvider>
      <Layout />
    </WorkspaceProvider>
  );
}
