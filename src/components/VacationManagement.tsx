import { useState } from 'react';
import VacationRequestForm from './VacationRequestForm';
import MyVacationRequests from './MyVacationRequests';

const VacationManagement = () => {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRequestSubmitted = () => {
    // Trigger refresh of the requests list
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="space-y-6">
      <VacationRequestForm onSubmitSuccess={handleRequestSubmitted} />
      <MyVacationRequests key={refreshKey} />
    </div>
  );
};

export default VacationManagement;
