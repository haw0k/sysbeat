import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CpuChart } from './CpuChart';
import { MemoryChart } from './MemoryChart';
import { LoadChart } from './LoadChart';
import { RawDataTable } from './RawDataTable';
import { Activity, Table2 } from 'lucide-react';

export function DashboardTabs() {
  const [activeTab, setActiveTab] = useState('charts');

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="mb-6 bg-secondary/50 border border-border/50">
        <TabsTrigger value="charts">
          <Activity className="mr-2 h-4 w-4" />
          Charts
        </TabsTrigger>
        <TabsTrigger value="raw">
          <Table2 className="mr-2 h-4 w-4" />
          Raw Data
        </TabsTrigger>
      </TabsList>

      <TabsContent value="charts">
        <div className="grid gap-6">
          <div className="chart-container">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                CPU Detail
              </h3>
              <span className="font-mono text-[10px] text-muted-foreground">5 min window</span>
            </div>
            <CpuChart />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="chart-container">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Memory History
                </h3>
                <span className="font-mono text-[10px] text-muted-foreground">5 min window</span>
              </div>
              <MemoryChart />
            </div>

            <div className="chart-container">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Load Timeline
                </h3>
                <span className="font-mono text-[10px] text-muted-foreground">5 min window</span>
              </div>
              <LoadChart />
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="raw">
        <div className="chart-container">
          <RawDataTable />
        </div>
      </TabsContent>
    </Tabs>
  );
}
