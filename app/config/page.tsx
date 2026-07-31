import ConfigForm from '@/components/ConfigForm';

export const metadata = { title: 'ตั้งค่า · CGM Analyser' };

export default function ConfigPage() {
  return (
    <main className="min-h-dvh">
      <ConfigForm />
    </main>
  );
}
