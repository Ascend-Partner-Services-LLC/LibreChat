import { useMemo } from 'react';
import { useMediaQuery, TooltipAnchor } from '@librechat/client';
import { useOutletContext } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getConfigDefaults, PermissionTypes, Permissions } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { PresetsMenu, HeaderNewChat, OpenSidebar } from './Menus';
import ModelSelector from './Menus/Endpoints/ModelSelector';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import ExportAndShareMenu from './ExportAndShareMenu';
import BookmarkMenu from './Menus/BookmarkMenu';
import { TemporaryChat } from './TemporaryChat';
import AddMultiConvo from './AddMultiConvo';
import { useHasAccess, useAuthContext } from '~/hooks';
import { Coins } from 'lucide-react';
import { cn } from '~/utils';

const defaultInterface = getConfigDefaults().interface;

export default function Header() {
  const { data: startupConfig } = useGetStartupConfig();
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const { isAuthenticated } = useAuthContext();

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );

  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });

  const hasAccessToMultiConvo = useHasAccess({
    permissionType: PermissionTypes.MULTI_CONVO,
    permission: Permissions.USE,
  });

  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  // Fetch balance if enabled
  const balanceEnabled = !!isAuthenticated && !!startupConfig?.balance?.enabled;
  const { data: balanceData } = useGetUserBalance({ enabled: balanceEnabled });
  const tokenCredits = balanceData?.tokenCredits ?? 0;
  
  // Format balance with K unit (e.g., 7,460,933 -> "7,460K")
  const formatBalance = (credits: number): string => {
    if (credits >= 1000) {
      const inK = Math.floor(credits / 1000);
      return `${inK.toLocaleString()}K`;
    }
    return credits.toLocaleString();
  };

  return (
    <div className="via-presentation/70 md:from-presentation/80 md:via-presentation/50 2xl:from-presentation/0 absolute top-0 z-10 flex h-14 w-full items-center justify-between bg-gradient-to-b from-presentation to-transparent p-2 font-semibold text-text-primary 2xl:via-transparent">
      <div className="hide-scrollbar flex w-full items-center justify-between gap-2 overflow-x-auto">
        <div className="mx-1 flex items-center">
          <AnimatePresence initial={false}>
            {!navVisible && (
              <motion.div
                className="flex items-center gap-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                key="header-buttons"
              >
                <OpenSidebar setNavVisible={setNavVisible} className="max-md:hidden" />
                <HeaderNewChat />
              </motion.div>
            )}
          </AnimatePresence>
          {!(navVisible && isSmallScreen) && (
            <div
              className={cn(
                'flex items-center gap-2',
                !isSmallScreen ? 'transition-all duration-200 ease-in-out' : '',
                !navVisible && !isSmallScreen ? 'pl-2' : '',
              )}
            >
              <ModelSelector startupConfig={startupConfig} />
              {interfaceConfig.presets === true && interfaceConfig.modelSelect && <PresetsMenu />}
              {hasAccessToBookmarks === true && <BookmarkMenu />}
              {hasAccessToMultiConvo === true && <AddMultiConvo />}
              {isSmallScreen && (
                <>
                  <ExportAndShareMenu
                    isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
                  />
                  <TemporaryChat />
                  {/* Token Balance (mobile) - rightmost */}
                  {balanceEnabled && (
                    <TooltipAnchor
                      description={`Remaining balance: ${tokenCredits.toLocaleString()} tokens`}
                      render={
                        <div 
                          className="flex cursor-default items-center gap-1 rounded-xl border border-border-light bg-presentation px-2 py-1 text-xs shadow-sm transition-all ease-in-out hover:bg-surface-active-alt"
                        >
                          <Coins className="h-3.5 w-3.5 text-yellow-500" />
                          <span className={cn(
                            "font-medium",
                            tokenCredits < 1000 ? "text-red-500" : "text-text-primary"
                          )}>
                            {formatBalance(tokenCredits)}
                          </span>
                        </div>
                      }
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {!isSmallScreen && (
          <div className="flex items-center gap-2">
            <ExportAndShareMenu
              isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
            />
            <TemporaryChat />
            {/* Token Balance - rightmost */}
            {balanceEnabled && (
              <TooltipAnchor
                description={`Remaining balance: ${tokenCredits.toLocaleString()} tokens`}
                render={
                  <div 
                    className="flex cursor-default items-center gap-1.5 rounded-xl border border-border-light bg-presentation px-2.5 py-1.5 text-sm shadow-sm transition-all ease-in-out hover:bg-surface-active-alt"
                  >
                    <Coins className="h-4 w-4 text-yellow-500" />
                    <span className={cn(
                      "font-medium",
                      tokenCredits < 1000 ? "text-red-500" : "text-text-primary"
                    )}>
                      {formatBalance(tokenCredits)}
                    </span>
                  </div>
                }
              />
            )}
          </div>
        )}
      </div>
      {/* Empty div for spacing */}
      <div />
    </div>
  );
}
