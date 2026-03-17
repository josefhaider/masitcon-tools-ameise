"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, Edit, Users, UserPlus, X } from 'lucide-react';
import { logAudit } from '@/lib/auditLog';

interface Team {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
}

interface TeamMember {
  id: string;
  user_id: string;
  team_id: string;
  is_active: boolean;
  profile?: {
    full_name: string;
    email: string;
  };
}

interface Profile {
  id: string;
  full_name: string;
  email: string;
}

const TEAM_COLORS = [
  { value: '#3B82F6', label: 'Blau' },
  { value: '#10B981', label: 'Grün' },
  { value: '#F59E0B', label: 'Orange' },
  { value: '#EF4444', label: 'Rot' },
  { value: '#8B5CF6', label: 'Violett' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#06B6D4', label: 'Cyan' },
  { value: '#6B7280', label: 'Grau' },
];

const TeamManager = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [addMemberTeamId, setAddMemberTeamId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#3B82F6',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [teamsRes, membersRes, profilesRes] = await Promise.all([
        supabase.from('teams').select('*').order('name'),
        supabase.from('team_members').select('*, profile:profiles(full_name, email)').eq('is_active', true),
        supabase.from('profiles').select('id, full_name, email').eq('is_archived', false).order('full_name'),
      ]);

      setTeams(teamsRes.data || []);
      setTeamMembers(membersRes.data || []);
      setProfiles(profilesRes.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Fehler beim Laden der Daten');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Bitte Team-Namen eingeben');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('teams')
        .insert({
          name: formData.name,
          description: formData.description || null,
          color: formData.color,
        })
        .select()
        .single();

      if (error) throw error;

      await logAudit({
        action: 'INSERT',
        tableName: 'teams',
        recordId: data.id,
        newValues: { name: formData.name, description: formData.description, color: formData.color },
        description: `Team "${formData.name}" erstellt`,
      });

      toast.success('Team erstellt');
      setIsCreateOpen(false);
      setFormData({ name: '', description: '', color: '#3B82F6' });
      loadData();
    } catch (error) {
      console.error('Error creating team:', error);
      toast.error('Fehler beim Erstellen');
    }
  };

  const handleUpdateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam || !formData.name.trim()) return;

    try {
      const { error } = await supabase
        .from('teams')
        .update({
          name: formData.name,
          description: formData.description || null,
          color: formData.color,
        })
        .eq('id', editingTeam.id);

      if (error) throw error;

      await logAudit({
        action: 'UPDATE',
        tableName: 'teams',
        recordId: editingTeam.id,
        oldValues: { name: editingTeam.name, description: editingTeam.description, color: editingTeam.color },
        newValues: { name: formData.name, description: formData.description, color: formData.color },
        description: `Team "${formData.name}" aktualisiert`,
      });

      toast.success('Team aktualisiert');
      setEditingTeam(null);
      setFormData({ name: '', description: '', color: '#3B82F6' });
      loadData();
    } catch (error) {
      console.error('Error updating team:', error);
      toast.error('Fehler beim Aktualisieren');
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    if (!confirm(`Möchten Sie das Team "${team.name}" wirklich löschen?`)) return;

    try {
      // First remove all members
      await supabase.from('team_members').delete().eq('team_id', team.id);
      
      const { error } = await supabase.from('teams').delete().eq('id', team.id);
      if (error) throw error;

      await logAudit({
        action: 'DELETE',
        tableName: 'teams',
        recordId: team.id,
        oldValues: { name: team.name, description: team.description, color: team.color },
        description: `Team "${team.name}" gelöscht`,
      });

      toast.success('Team gelöscht');
      loadData();
    } catch (error) {
      console.error('Error deleting team:', error);
      toast.error('Fehler beim Löschen');
    }
  };

  const handleAddMember = async () => {
    if (!addMemberTeamId || !selectedUserId) return;

    // Check if already a member
    const existing = teamMembers.find(m => m.team_id === addMemberTeamId && m.user_id === selectedUserId);
    if (existing) {
      toast.error('Mitarbeiter ist bereits in diesem Team');
      return;
    }

    try {
      const { error } = await supabase
        .from('team_members')
        .insert({
          team_id: addMemberTeamId,
          user_id: selectedUserId,
          is_active: true,
        });

      if (error) throw error;

      const profile = profiles.find(p => p.id === selectedUserId);
      const team = teams.find(t => t.id === addMemberTeamId);

      await logAudit({
        action: 'INSERT',
        tableName: 'team_members',
        newValues: { team_id: addMemberTeamId, user_id: selectedUserId },
        description: `${profile?.full_name} zu Team "${team?.name}" hinzugefügt`,
      });

      toast.success('Mitarbeiter hinzugefügt');
      setAddMemberTeamId(null);
      setSelectedUserId('');
      loadData();
    } catch (error) {
      console.error('Error adding member:', error);
      toast.error('Fehler beim Hinzufügen');
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    const team = teams.find(t => t.id === member.team_id);
    if (!confirm(`Möchten Sie ${member.profile?.full_name} aus dem Team "${team?.name}" entfernen?`)) return;

    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', member.id);

      if (error) throw error;

      await logAudit({
        action: 'DELETE',
        tableName: 'team_members',
        recordId: member.id,
        oldValues: { team_id: member.team_id, user_id: member.user_id },
        description: `${member.profile?.full_name} aus Team "${team?.name}" entfernt`,
      });

      toast.success('Mitarbeiter entfernt');
      loadData();
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error('Fehler beim Entfernen');
    }
  };

  const openEditDialog = (team: Team) => {
    setFormData({
      name: team.name,
      description: team.description || '',
      color: team.color || '#3B82F6',
    });
    setEditingTeam(team);
  };

  const getTeamMembers = (teamId: string) => {
    return teamMembers.filter(m => m.team_id === teamId);
  };

  const getAvailableProfiles = (teamId: string) => {
    const memberIds = teamMembers.filter(m => m.team_id === teamId).map(m => m.user_id);
    return profiles.filter(p => !memberIds.includes(p.id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Users className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold">Teams verwalten</h2>
          </div>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Neues Team
          </Button>
        </div>

        {teams.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Noch keine Teams vorhanden</p>
            <Button variant="outline" className="mt-4" onClick={() => setIsCreateOpen(true)}>
              Erstes Team erstellen
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {teams.map(team => {
              const members = getTeamMembers(team.id);
              return (
                <Card key={team.id} className="p-4 border-l-4" style={{ borderLeftColor: team.color || '#3B82F6' }}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-semibold">{team.name}</h3>
                        <Badge variant="secondary">{members.length} Mitarbeiter</Badge>
                      </div>
                      {team.description && (
                        <p className="text-sm text-muted-foreground mb-3">{team.description}</p>
                      )}
                      
                      <div className="flex flex-wrap gap-2">
                        {members.map(member => (
                          <Badge 
                            key={member.id} 
                            variant="outline"
                            className="flex items-center gap-1 pr-1"
                          >
                            {member.profile?.full_name}
                            <button
                              onClick={() => handleRemoveMember(member)}
                              className="ml-1 hover:bg-destructive/20 rounded p-0.5"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2"
                          onClick={() => setAddMemberTeamId(team.id)}
                        >
                          <UserPlus className="h-3 w-3 mr-1" />
                          Hinzufügen
                        </Button>
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(team)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteTeam(team)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      {/* Create/Edit Team Dialog */}
      <Dialog open={isCreateOpen || !!editingTeam} onOpenChange={() => {
        setIsCreateOpen(false);
        setEditingTeam(null);
        setFormData({ name: '', description: '', color: '#3B82F6' });
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTeam ? 'Team bearbeiten' : 'Neues Team erstellen'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={editingTeam ? handleUpdateTeam : handleCreateTeam} className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="z.B. Entwicklung"
                required
              />
            </div>
            <div>
              <Label htmlFor="description">Beschreibung (optional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Kurze Beschreibung des Teams..."
                rows={2}
              />
            </div>
            <div>
              <Label>Farbe</Label>
              <div className="flex gap-2 mt-2">
                {TEAM_COLORS.map(color => (
                  <button
                    key={color.value}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      formData.color === color.value ? 'scale-110 border-foreground' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => setFormData({ ...formData, color: color.value })}
                    title={color.label}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => {
                setIsCreateOpen(false);
                setEditingTeam(null);
              }}>
                Abbrechen
              </Button>
              <Button type="submit">
                {editingTeam ? 'Speichern' : 'Erstellen'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={!!addMemberTeamId} onOpenChange={() => {
        setAddMemberTeamId(null);
        setSelectedUserId('');
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mitarbeiter hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Mitarbeiter auswählen</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Mitarbeiter wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {addMemberTeamId && getAvailableProfiles(addMemberTeamId).map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.full_name} ({profile.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddMemberTeamId(null)}>
              Abbrechen
            </Button>
            <Button onClick={handleAddMember} disabled={!selectedUserId}>
              Hinzufügen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TeamManager;
