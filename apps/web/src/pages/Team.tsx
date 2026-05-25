import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  status: 'active' | 'pending';
}

export function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setTimeout(() => {
      setMembers([
        { id: '1', name: 'Sarah Johnson', email: 'sarah@paintflow.com', role: 'Admin', status: 'active' },
        { id: '2', name: 'Mike Chen', email: 'mike@paintflow.com', role: 'Estimator', status: 'active' },
        { id: '3', name: 'Emily Davis', email: 'emily@paintflow.com', role: 'Crew Lead', status: 'active' },
        { id: '4', name: 'Tom Wilson', email: 'tom@paintflow.com', role: 'Painter', status: 'pending' },
      ]);
      setIsLoading(false);
    }, 500);
  }, []);

  if (isLoading) return <div className="flex justify-center py-12">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Team</h1>
        <Button>Invite Member</Button>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="No team members yet"
          description="Invite your team to collaborate"
          action={{ label: 'Invite Member', onClick: () => {} }}
        />
      ) : (
        <div className="grid gap-4">
          {members.map(member => (
            <Card key={member.id}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar name={member.name} src={member.avatar} />
                    <div>
                      <h3 className="font-semibold">{member.name}</h3>
                      <p className="text-sm text-gray-600">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge>{member.role}</Badge>
                    <Badge variant={member.status === 'active' ? 'success' : 'warning'}>
                      {member.status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
