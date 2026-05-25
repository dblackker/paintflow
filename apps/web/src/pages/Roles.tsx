import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Table } from '@/components/Table';

export function Roles() {
  const roles = [
    { name: 'Admin', users: 1, permissions: 'Full access' },
    { name: 'Estimator', users: 2, permissions: 'Estimates, Jobs, Leads' },
    { name: 'Crew Lead', users: 3, permissions: 'Jobs, Time tracking' },
    { name: 'Painter', users: 8, permissions: 'Time tracking only' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Roles & Permissions</h1>
        <Button>New Role</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <thead>
              <tr className="border-b">
                <th className="text-left p-4">Role</th>
                <th className="text-left p-4">Users</th>
                <th className="text-left p-4">Permissions</th>
                <th className="text-left p-4"></th>
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role.name} className="border-b">
                  <td className="p-4 font-medium">{role.name}</td>
                  <td className="p-4">{role.users}</td>
                  <td className="p-4 text-sm text-gray-600">{role.permissions}</td>
                  <td className="p-4"><Button variant="ghost" size="sm">Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
