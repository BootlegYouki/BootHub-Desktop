import { View, Text } from 'react-native';
import React from 'react';
import { TitleBar } from './components/TitleBar';
import { TuiContainer } from './components/TuiContainer';
import { TuiButton } from './components/TuiButton';
import { Folder, Search, Settings } from 'lucide-react-native';

export default function App() {
  return (
    <View className="flex-1 bg-background text-foreground overflow-hidden font-mono">
      {/* TITLE BAR */}
      <TitleBar title="BootHub Native" />

      {/* MAIN LAYOUT */}
      <View className="flex-1 p-4 flex-row gap-4">
        
        {/* SIDEBAR */}
        <View className="w-64 flex flex-col gap-4">
          <TuiContainer label="Navigation" className="flex-1">
            <View className="flex flex-col gap-2 p-2">
              <TuiButton variant="accent" className="!justify-start">
                <View className="flex-row items-center gap-2">
                  <Folder size={16} color="#000" />
                  <Text className="text-primary-foreground font-bold font-mono">All Items</Text>
                </View>
              </TuiButton>
              
              <TuiButton variant="outline" className="!justify-start">
                <View className="flex-row items-center gap-2">
                  <Search size={16} color="#a1a1aa" />
                  <Text className="text-muted font-bold font-mono">Search</Text>
                </View>
              </TuiButton>

              <TuiButton variant="outline" className="!justify-start">
                <View className="flex-row items-center gap-2">
                  <Settings size={16} color="#a1a1aa" />
                  <Text className="text-muted font-bold font-mono">Settings</Text>
                </View>
              </TuiButton>
            </View>
          </TuiContainer>
        </View>

        {/* MAIN CONTENT AREA */}
        <View className="flex-1 flex flex-col gap-4">
          <TuiContainer label="Workspace" className="flex-1">
            <View className="flex-1 items-center justify-center">
              <Text className="text-muted font-mono mb-4 text-center">
                Welcome to BootHub Native!{'\n'}
                We've started from scratch with a clean slate.
              </Text>
              
              <View className="w-48">
                <TuiButton variant="accent">
                  <Text className="text-primary-foreground font-bold font-mono">Create Item</Text>
                </TuiButton>
              </View>
            </View>
          </TuiContainer>
        </View>

      </View>
    </View>
  );
}
