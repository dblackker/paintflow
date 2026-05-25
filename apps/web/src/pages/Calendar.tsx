import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';

export function Calendar() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Calendar</h2>
          <p className="text-gray-600 mt-1">Schedule jobs and appointments</p>
        </div>
        <Button>Add Event</Button>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-7 gap-px bg-gray-200 border rounded-lg overflow-hidden">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="bg-gray-50 p-2 text-center text-xs font-medium text-gray-700">{day}</div>
            ))}
            {Array.from({ length: 35 }, (_, i) => {
              const day = i - 3;
              const hasEvent = [5, 10, 15, 22].includes(day);
              return (
                <div key={i} className="bg-white p-2 min-h-[100px]">
                  {day > 0 && day <= 31 && (
                    <>
                      <div className="text-sm">{day}</div>
                      {hasEvent && (
                        <div className="mt-1 text-xs bg-blue-100 text-blue-800 px-1 py-0.5 rounded truncate">
                          Job #{day}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
