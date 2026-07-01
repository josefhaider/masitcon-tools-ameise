"use client";

import { useState } from 'react';
import BusinessTripForm from './BusinessTripForm';
import MyBusinessTrips from './MyBusinessTrips';

const TravelExpenseManagement = () => {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <BusinessTripForm onSubmitSuccess={() => setRefreshKey((k) => k + 1)} />
      <MyBusinessTrips key={refreshKey} />
    </div>
  );
};

export default TravelExpenseManagement;
