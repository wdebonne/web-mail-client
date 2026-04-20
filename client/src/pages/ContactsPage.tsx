import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Contact, ContactGroup } from '../types';
import {
  Search, Plus, X, Mail, Phone, Building, Star, Edit2, Trash2,
  Users, User, ChevronRight
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>();
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const { data: contactsData, isLoading } = useQuery({
    queryKey: ['contacts', searchQuery, selectedGroup],
    queryFn: () => api.getContacts({ search: searchQuery || undefined, groupId: selectedGroup }),
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['contactGroups'],
    queryFn: api.getContactGroups,
  });

  const { data: distributionLists = [] } = useQuery({
    queryKey: ['distributionLists'],
    queryFn: api.getDistributionLists,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteContact,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setSelectedContact(null);
      toast.success('Contact supprimé');
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => editingContact ? api.updateContact(editingContact.id, data) : api.createContact(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setShowForm(false);
      setEditingContact(null);
      toast.success(editingContact ? 'Contact mis à jour' : 'Contact créé');
    },
  });

  const contacts = contactsData?.contacts || [];

  const getInitials = (contact: Contact) => {
    if (contact.first_name && contact.last_name) {
      return (contact.first_name[0] + contact.last_name[0]).toUpperCase();
    }
    return (contact.display_name || contact.email || '?')[0].toUpperCase();
  };

  return (
    <div className="h-full flex">
      {/* Left panel: groups & list */}
      <div className="w-80 border-r border-outlook-border flex flex-col flex-shrink-0">
        {/* Search & add */}
        <div className="p-3 border-b border-outlook-border">
          <button
            onClick={() => { setEditingContact(null); setShowForm(true); }}
            className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded-md py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 mb-3"
          >
            <Plus size={14} /> Nouveau contact
          </button>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher des contacts..."
              className="w-full pl-9 pr-3 py-1.5 border border-outlook-border rounded text-sm focus:outline-none focus:border-outlook-blue"
            />
          </div>
        </div>

        {/* Groups */}
        <div className="px-3 py-2 border-b border-outlook-border">
          <button
            onClick={() => setSelectedGroup(undefined)}
            className={`w-full text-left px-2 py-1 text-sm rounded flex items-center gap-2
              ${!selectedGroup ? 'bg-outlook-bg-selected font-medium' : 'hover:bg-outlook-bg-hover'}`}
          >
            <Users size={14} className={!selectedGroup ? 'text-outlook-blue' : ''} />
            Tous les contacts
            <span className="ml-auto text-xs text-outlook-text-disabled">{contactsData?.total || 0}</span>
          </button>
          {groups.map((group: ContactGroup) => (
            <button
              key={group.id}
              onClick={() => setSelectedGroup(group.id)}
              className={`w-full text-left px-2 py-1 text-sm rounded flex items-center gap-2
                ${selectedGroup === group.id ? 'bg-outlook-bg-selected font-medium' : 'hover:bg-outlook-bg-hover'}`}
            >
              <Users size={14} className={selectedGroup === group.id ? 'text-outlook-blue' : ''} />
              {group.name}
              <span className="ml-auto text-xs text-outlook-text-disabled">{group.member_count}</span>
            </button>
          ))}
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 border-b border-outlook-border">
                <div className="skeleton w-10 h-10 rounded-full" />
                <div className="flex-1">
                  <div className="skeleton h-4 w-32 rounded mb-1" />
                  <div className="skeleton h-3 w-40 rounded" />
                </div>
              </div>
            ))
          ) : contacts.length === 0 ? (
            <div className="text-center py-8 text-outlook-text-disabled text-sm">Aucun contact trouvé</div>
          ) : (
            contacts.map((contact: Contact) => (
              <button
                key={contact.id}
                onClick={() => setSelectedContact(contact)}
                className={`w-full flex items-center gap-3 px-3 py-2 border-b border-outlook-border text-left transition-colors
                  ${selectedContact?.id === contact.id ? 'bg-blue-50' : 'hover:bg-outlook-bg-hover'}`}
              >
                <div className="w-10 h-10 rounded-full bg-outlook-blue/10 text-outlook-blue flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {contact.avatar_url ? (
                    <img src={contact.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : getInitials(contact)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate text-outlook-text-primary">
                    {contact.display_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.email}
                  </div>
                  <div className="text-xs text-outlook-text-secondary truncate">{contact.email}</div>
                  {contact.company && (
                    <div className="text-xs text-outlook-text-disabled truncate">{contact.company}</div>
                  )}
                </div>
                <ChevronRight size={14} className="text-outlook-text-disabled" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel: detail */}
      <div className="flex-1 overflow-y-auto bg-white">
        {selectedContact ? (
          <div className="max-w-2xl mx-auto py-8 px-6">
            {/* Header */}
            <div className="flex items-start gap-4 mb-6">
              <div className="w-20 h-20 rounded-full bg-outlook-blue/10 text-outlook-blue flex items-center justify-center text-2xl font-semibold flex-shrink-0">
                {selectedContact.avatar_url ? (
                  <img src={selectedContact.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                ) : getInitialsLarge(selectedContact)}
              </div>
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-outlook-text-primary">
                  {selectedContact.display_name || `${selectedContact.first_name || ''} ${selectedContact.last_name || ''}`.trim()}
                </h1>
                {selectedContact.job_title && (
                  <p className="text-sm text-outlook-text-secondary">{selectedContact.job_title}</p>
                )}
                {selectedContact.company && (
                  <p className="text-sm text-outlook-text-secondary flex items-center gap-1">
                    <Building size={12} /> {selectedContact.company}
                    {selectedContact.department && ` - ${selectedContact.department}`}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => { setEditingContact(selectedContact); setShowForm(true); }}
                  className="p-2 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary"
                  title="Modifier"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Supprimer ce contact ?')) {
                      deleteMutation.mutate(selectedContact.id);
                    }
                  }}
                  className="p-2 hover:bg-red-50 rounded text-outlook-text-secondary hover:text-outlook-danger"
                  title="Supprimer"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Contact info */}
            <div className="space-y-4">
              {selectedContact.email && (
                <InfoRow icon={Mail} label="E-mail" value={selectedContact.email} isLink />
              )}
              {selectedContact.phone && (
                <InfoRow icon={Phone} label="Téléphone" value={selectedContact.phone} />
              )}
              {selectedContact.mobile && (
                <InfoRow icon={Phone} label="Mobile" value={selectedContact.mobile} />
              )}
              {selectedContact.notes && (
                <div className="mt-4 pt-4 border-t border-outlook-border">
                  <h3 className="text-sm font-medium text-outlook-text-primary mb-1">Notes</h3>
                  <p className="text-sm text-outlook-text-secondary whitespace-pre-wrap">{selectedContact.notes}</p>
                </div>
              )}
              {selectedContact.source && (
                <div className="text-xs text-outlook-text-disabled mt-4">
                  Source : {selectedContact.source === 'nextcloud' ? 'NextCloud' : 'Locale'}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-outlook-text-disabled">
            <div className="text-center">
              <User size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Sélectionnez un contact</p>
            </div>
          </div>
        )}
      </div>

      {/* Contact form modal */}
      {showForm && (
        <ContactForm
          contact={editingContact}
          groups={groups}
          onSubmit={(data) => createMutation.mutate(data)}
          onClose={() => { setShowForm(false); setEditingContact(null); }}
          isSubmitting={createMutation.isPending}
        />
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, isLink }: { icon: any; label: string; value: string; isLink?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={16} className="text-outlook-text-disabled flex-shrink-0" />
      <div>
        <div className="text-xs text-outlook-text-disabled">{label}</div>
        {isLink ? (
          <a href={`mailto:${value}`} className="text-sm text-outlook-blue hover:underline">{value}</a>
        ) : (
          <div className="text-sm text-outlook-text-primary">{value}</div>
        )}
      </div>
    </div>
  );
}

function getInitialsLarge(c: Contact) {
  if (c.first_name && c.last_name) return (c.first_name[0] + c.last_name[0]).toUpperCase();
  return (c.display_name || c.email || '?')[0].toUpperCase();
}

function ContactForm({ contact, groups, onSubmit, onClose, isSubmitting }: {
  contact: Contact | null;
  groups: ContactGroup[];
  onSubmit: (data: any) => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const [firstName, setFirstName] = useState(contact?.first_name || '');
  const [lastName, setLastName] = useState(contact?.last_name || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [mobile, setMobile] = useState(contact?.mobile || '');
  const [company, setCompany] = useState(contact?.company || '');
  const [jobTitle, setJobTitle] = useState(contact?.job_title || '');
  const [department, setDepartment] = useState(contact?.department || '');
  const [notes, setNotes] = useState(contact?.notes || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      firstName, lastName, email, phone, mobile,
      company, jobTitle, department, notes,
      displayName: `${firstName} ${lastName}`.trim() || email,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[500px] max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{contact ? 'Modifier le contact' : 'Nouveau contact'}</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Prénom" value={firstName} onChange={setFirstName} />
            <FormField label="Nom" value={lastName} onChange={setLastName} />
          </div>
          <FormField label="E-mail" value={email} onChange={setEmail} type="email" />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Téléphone" value={phone} onChange={setPhone} type="tel" />
            <FormField label="Mobile" value={mobile} onChange={setMobile} type="tel" />
          </div>
          <FormField label="Entreprise" value={company} onChange={setCompany} />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Fonction" value={jobTitle} onChange={setJobTitle} />
            <FormField label="Service" value={department} onChange={setDepartment} />
          </div>
          <div>
            <label className="text-xs text-outlook-text-secondary">Notes</label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={3} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:border-outlook-blue"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">Annuler</button>
            <button type="submit" disabled={isSubmitting} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 text-sm rounded-md disabled:opacity-50">
              {isSubmitting ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-outlook-text-secondary">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-outlook-blue"
      />
    </div>
  );
}
