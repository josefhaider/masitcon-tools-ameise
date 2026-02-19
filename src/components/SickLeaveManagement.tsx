import { useState } from 'react';
import SickLeaveForm from './SickLeaveForm';
import MySickLeaves from './MySickLeaves';

export default function SickLeaveManagement() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleSuccess = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <SickLeaveForm onSuccess={handleSuccess} />
      <MySickLeaves refreshTrigger={refreshTrigger} />
    </div>
  );
}
